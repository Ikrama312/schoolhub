import type { UserStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import type { Role } from '@/config/navigation';
import { MAX_PARTICIPANTS } from '@/lib/messaging/constants';

/**
 * PRD-13 contact rules (FR-5, FR-6, FR-7, FR-32, ADR-3). The single source of truth for
 * who may message whom: create, send, contacts and the student/roster actions all go
 * through here. `canMessageWith` is pure; `loadRelations` fetches everything it needs
 * for a set of users in one batch.
 */

export interface Party {
  id: string;
  role: Role;
}
export interface RelUser extends Party {
  status: UserStatus;
}

export interface Relations {
  users: Map<string, RelUser>;
  /** `${teacherId}|${studentId}`: ACTIVE enrollment in a course the teacher manages (teacherId or co-teacher), or current-year homeroom. */
  teaches: Set<string>;
  /** parentId → linked studentIds */
  children: Map<string, string[]>;
}

const isStaff = (role: Role) => role === 'ADMIN' || role === 'TEACHER';
const teaches = (rel: Relations, teacherId: string, studentId: string) => rel.teaches.has(`${teacherId}|${studentId}`);
const childrenOf = (rel: Relations, parentId: string) => rel.children.get(parentId) ?? [];

/** The FR-5 sender → recipient matrix. Non-ACTIVE recipients and self are never messageable. */
export function canMessageWith(sender: Party, recipient: RelUser, rel: Relations): boolean {
  if (sender.id === recipient.id || recipient.status !== 'ACTIVE') return false;
  if (sender.role === 'ADMIN' || recipient.role === 'ADMIN') return true;
  switch (sender.role) {
    case 'TEACHER':
      if (recipient.role === 'TEACHER') return true;
      if (recipient.role === 'STUDENT') return teaches(rel, sender.id, recipient.id);
      return childrenOf(rel, recipient.id).some((child) => teaches(rel, sender.id, child));
    case 'STUDENT':
      return recipient.role === 'TEACHER' && teaches(rel, recipient.id, sender.id);
    case 'PARENT':
      return recipient.role === 'TEACHER' && childrenOf(rel, sender.id).some((child) => teaches(rel, recipient.id, child));
    default:
      return false;
  }
}

/** Loads roles/status, parent links, managed-course enrollments and current homerooms for `ids` in one batch. */
export async function loadRelations(ids: string[]): Promise<Relations> {
  const unique = [...new Set(ids)];
  const [users, links] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, role: true, status: true, archivedAt: true } }),
    prisma.parentStudentLink.findMany({ where: { parentId: { in: unique } }, select: { parentId: true, studentId: true } }),
  ]);
  const children = new Map<string, string[]>();
  for (const l of links) children.set(l.parentId, [...(children.get(l.parentId) ?? []), l.studentId]);

  const teacherIds = users.filter((u) => u.role === 'TEACHER').map((u) => u.id);
  const studentIds = [...new Set([...users.filter((u) => u.role === 'STUDENT').map((u) => u.id), ...links.map((l) => l.studentId)])];
  const pairs = new Set<string>();
  if (teacherIds.length && studentIds.length) {
    const teacherSet = new Set(teacherIds);
    const [enrollments, homerooms] = await Promise.all([
      prisma.enrollment.findMany({
        where: {
          status: 'ACTIVE',
          studentId: { in: studentIds },
          course: { archivedAt: null, OR: [{ teacherId: { in: teacherIds } }, { coTeacherIds: { hasSome: teacherIds } }] },
        },
        select: { studentId: true, course: { select: { teacherId: true, coTeacherIds: true } } },
      }),
      prisma.sectionMember.findMany({
        where: { studentId: { in: studentIds }, section: { homeroomTeacherId: { in: teacherIds }, academicYear: { isCurrent: true } } },
        select: { studentId: true, section: { select: { homeroomTeacherId: true } } },
      }),
    ]);
    for (const e of enrollments) {
      for (const t of [e.course.teacherId, ...e.course.coTeacherIds]) if (teacherSet.has(t)) pairs.add(`${t}|${e.studentId}`);
    }
    for (const h of homerooms) if (h.section.homeroomTeacherId) pairs.add(`${h.section.homeroomTeacherId}|${h.studentId}`);
  }

  return {
    users: new Map(users.map((u) => [u.id, { id: u.id, role: u.role, status: u.archivedAt ? 'ARCHIVED' : u.status }])),
    teaches: pairs,
    children,
  };
}

export async function canMessage(sender: Party, recipientId: string): Promise<boolean> {
  const rel = await loadRelations([sender.id, recipientId]);
  const recipient = rel.users.get(recipientId);
  return !!recipient && canMessageWith(sender, recipient, rel);
}

/** The subset of `ids` the sender may message. */
export async function messageableIds(sender: Party, ids: string[]): Promise<string[]> {
  const rel = await loadRelations([sender.id, ...ids]);
  return [...new Set(ids)].filter((id) => {
    const u = rel.users.get(id);
    return !!u && canMessageWith(sender, u, rel);
  });
}

export type NewConversationProblem = 'TOO_FEW_PARTICIPANTS' | 'TOO_MANY_PARTICIPANTS' | 'CONTACT_RULES' | 'GROUP_NEEDS_STAFF';

/** Pure FR-6 check over already-loaded relations; null when the conversation may be created. */
export function checkNewConversation(creator: Party, otherIds: string[], rel: Relations): NewConversationProblem | null {
  const others = [...new Set(otherIds)].filter((id) => id !== creator.id);
  if (others.length < 1) return 'TOO_FEW_PARTICIPANTS';
  if (others.length + 1 > MAX_PARTICIPANTS) return 'TOO_MANY_PARTICIPANTS';
  const users = others.map((id) => rel.users.get(id));
  if (users.some((u) => !u || !canMessageWith(creator, u, rel))) return 'CONTACT_RULES';
  const roles = [creator.role, ...users.map((u) => u!.role)];
  if (roles.includes('STUDENT') && !roles.some(isStaff)) return 'GROUP_NEEDS_STAFF';
  return null;
}

/** FR-6: throws 403 (nothing created) on any violation; returns the other participants and involvesStudent (FR-30). */
export async function validateNewConversation(creator: Party, otherIds: string[]): Promise<{ participantIds: string[]; involvesStudent: boolean }> {
  const rel = await loadRelations([creator.id, ...otherIds]);
  const problem = checkNewConversation(creator, otherIds, rel);
  if (problem === 'TOO_FEW_PARTICIPANTS') throw new AppError('VALIDATION_ERROR', 'Pick at least one recipient.');
  if (problem) throw new AppError('FORBIDDEN', 'You cannot start this conversation.', { reason: problem });
  const participantIds = [...new Set(otherIds)].filter((id) => id !== creator.id);
  const involvesStudent = creator.role === 'STUDENT' || participantIds.some((id) => rel.users.get(id)!.role === 'STUDENT');
  return { participantIds, involvesStudent };
}

/**
 * A4/FR-7 pure: staff can always send; anyone else needs a live relationship with at least one
 * staff participant who has not left. `participants` are the ones still in the conversation.
 */
export function canSendInWith(sender: Party, participantIds: string[], rel: Relations): boolean {
  if (isStaff(sender.role)) return true;
  return participantIds.some((id) => {
    const u = rel.users.get(id);
    return !!u && isStaff(u.role) && canMessageWith(sender, u, rel);
  });
}

export async function canSendIn(sender: Party, participantIds: string[]): Promise<boolean> {
  if (isStaff(sender.role)) return true;
  return canSendInWith(sender, participantIds, await loadRelations([sender.id, ...participantIds]));
}
