import { prisma } from '@/server/db';

export interface RoomInput {
  name: string;
  building?: string | null;
  capacity?: number | null;
}

export interface UpdateRoomInput extends Partial<RoomInput> {
  archived?: boolean;
}

export async function listRooms() {
  return prisma.room.findMany({ orderBy: { name: 'asc' } });
}

export async function createRoom(input: RoomInput) {
  return prisma.room.create({ data: input });
}

export async function updateRoom(id: string, input: UpdateRoomInput) {
  const existing = await prisma.room.findUniqueOrThrow({ where: { id } });
  return prisma.room.update({
    where: { id },
    data: {
      name: input.name ?? existing.name,
      building: input.building === undefined ? existing.building : input.building,
      capacity: input.capacity === undefined ? existing.capacity : input.capacity,
      archivedAt: input.archived === undefined ? existing.archivedAt : input.archived ? new Date() : null,
    },
  });
}
