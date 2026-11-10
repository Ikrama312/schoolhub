'use client';

import Box from '@mui/material/Box';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import { Fragment, useEffect, useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useColorScheme } from '@mui/material/styles';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import { signOut } from 'next-auth/react';
import { navigationForRole } from '@/config/navigation';
import type { SessionUser } from '@/server/auth/requireRole';
import { UserAvatar } from '@/components/UserAvatar/UserAvatar';
import { NotificationBell } from '@/components/NotificationBell/NotificationBell';
import { MessagesNavBadge } from '@/components/messaging/MessagesNavBadge';
import { ChildSwitcher, type SwitcherChild } from '@/components/ChildSwitcher/ChildSwitcher';

const DRAWER_WIDTH_EXPANDED = 256;
const DRAWER_WIDTH_COLLAPSED = 64;
const COLLAPSE_STORAGE_KEY = 'schoolhub.sidebar.collapsed';

export interface AppShellProps {
  user: SessionUser;
  schoolShortName: string;
  /** PRD-13 FR-23: shows the Safeguarding nav entry. */
  safeguardingLead?: boolean;
  /** PRD-15 FR-42: TEACHER is homeroom teacher of a current-year section. */
  homeroom?: boolean;
  /** PRD-15 FR-3/FR-6: PARENT's linked children and the resolved selection. */
  linkedChildren?: SwitcherChild[];
  selectedChildId?: string | null;
  children: React.ReactNode;
}

const DESKTOP_BREAKPOINT_PX = 1024;

export function AppShell({
  user,
  schoolShortName,
  safeguardingLead = false,
  homeroom = false,
  linkedChildren = [],
  selectedChildId = null,
  children,
}: AppShellProps) {
  const { mode, setMode } = useColorScheme();
  const pathname = usePathname();
  // FR-31/NFR-4 fix the fork at exactly 1024px — MUI's own "lg" breakpoint
  // (1200px) doesn't match that, so this uses an explicit media query.
  const isDesktop = useMediaQuery(`(min-width:${DESKTOP_BREAKPOINT_PX}px)`);

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (stored === 'true') setCollapsed(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      return next;
    });
  };

  const drawerWidth = collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH_EXPANDED;
  const items = navigationForRole(user.role, { safeguardingLead, homeroom });
  const fullName = `${user.firstName} ${user.lastName}`;

  const navList = (
    <List sx={{ pt: 1 }}>
      {items.map((item, index) => {
        const Icon = item.icon;
        // Subheader above the first item of each consecutive group run; hidden when collapsed.
        const showGroup =
          item.group && item.group !== items[index - 1]?.group && !(collapsed && isDesktop);
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const button = (
          <ListItemButton
            key={item.href}
            component={Link}
            href={item.href}
            selected={active}
            onClick={() => setMobileOpen(false)}
            sx={{ justifyContent: collapsed && isDesktop ? 'center' : 'flex-start' }}
          >
            <ListItemIcon sx={{ minWidth: collapsed && isDesktop ? 0 : 40, justifyContent: 'center' }}>
              {item.badge === 'messages' ? (
                <MessagesNavBadge>
                  <Icon />
                </MessagesNavBadge>
              ) : (
                <Icon />
              )}
            </ListItemIcon>
            {!(collapsed && isDesktop) && <ListItemText primary={item.label} />}
          </ListItemButton>
        );
        return (
          <Fragment key={item.href}>
            {showGroup && (
              <ListSubheader disableSticky sx={{ lineHeight: 2.5, bgcolor: 'transparent' }}>
                {item.group}
              </ListSubheader>
            )}
            {collapsed && isDesktop ? (
              <Tooltip title={item.label} placement="right">
                {button}
              </Tooltip>
            ) : (
              button
            )}
          </Fragment>
        );
      })}
    </List>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        sx={{
          zIndex: (t) => t.zIndex.drawer + 1,
          ...(isDesktop
            ? { width: `calc(100% - ${drawerWidth}px)`, ml: `${drawerWidth}px` }
            : {}),
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          {!isDesktop && (
            <IconButton
              color="inherit"
              aria-label="Open navigation"
              edge="start"
              onClick={() => setMobileOpen(true)}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
            {schoolShortName}
          </Typography>

          {user.role === 'PARENT' && <ChildSwitcher items={linkedChildren} selectedId={selectedChildId} />}

          <NotificationBell />

          <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            <IconButton
              color="inherit"
              aria-label="Toggle color mode"
              onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
            >
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>

          <IconButton onClick={(event) => setMenuAnchor(event.currentTarget)} aria-label="User menu">
            <UserAvatar userId={user.id} name={fullName} size={32} />
          </IconButton>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle2">{fullName}</Typography>
              <Chip size="small" label={user.role} sx={{ mt: 0.5 }} />
            </Box>
            <Divider />
            <MenuItem component={Link} href="/account/security" onClick={() => setMenuAnchor(null)}>
              <LockOutlinedIcon fontSize="small" sx={{ mr: 1 }} /> Account security
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                void signOut({ redirectTo: '/login' });
              }}
            >
              <LogoutIcon fontSize="small" sx={{ mr: 1 }} /> Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {isDesktop ? (
        <Drawer
          variant="permanent"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box', overflowX: 'hidden' },
          }}
        >
          <Toolbar />
          {navList}
          <Box sx={{ mt: 'auto', display: 'flex', justifyContent: 'flex-end', p: 1 }}>
            <IconButton onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          </Box>
        </Drawer>
      ) : (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH_EXPANDED, boxSizing: 'border-box' } }}
        >
          <Toolbar />
          {navList}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: isDesktop ? `calc(100% - ${drawerWidth}px)` : '100%',
        }}
      >
        <Toolbar />
        {children}
      </Box>
    </Box>
  );
}
