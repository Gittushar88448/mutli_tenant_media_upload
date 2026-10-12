import {
  CalendarRangeIcon,
  CableIcon,
  FilmIcon,
  LayoutGridIcon,
  ListOrderedIcon,
  PenLineIcon,
  Settings2Icon,
  UsersIcon,
  BuildingIcon,
  RadioTowerIcon,
  ScrollTextIcon,
  SlidersHorizontalIcon,
  AtSignIcon,
} from "lucide-react";

export const APP_NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutGridIcon, key: "G O" },
  { href: "/compose", label: "Compose", icon: PenLineIcon, key: "C" },
  { href: "/posts", label: "Queue", icon: ListOrderedIcon, key: "G Q" },
  { href: "/calendar", label: "Calendar", icon: CalendarRangeIcon, key: "G C" },
  { href: "/media", label: "Media", icon: FilmIcon, key: "G M" },
  { href: "/accounts", label: "Channels", icon: CableIcon, key: "G A" },
  { href: "/settings", label: "Settings", icon: Settings2Icon, key: "G S" },
];

export const ADMIN_NAV = [
  { href: "/admin", label: "Control room", icon: RadioTowerIcon },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
  { href: "/admin/workspaces", label: "Workspaces", icon: BuildingIcon },
  { href: "/admin/publishing", label: "Publishing", icon: ListOrderedIcon },
  { href: "/admin/accounts", label: "Channels", icon: AtSignIcon },
  { href: "/admin/audit", label: "Audit log", icon: ScrollTextIcon },
  { href: "/admin/settings", label: "Platform settings", icon: SlidersHorizontalIcon },
];
