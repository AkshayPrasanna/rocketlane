"use client";

import {
  AlertTriangle,
  Bot,
  Download,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  Sidebar as SidebarRoot,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";

const navItems = [
  { href: "/" as const, icon: LayoutDashboard, label: "Deals" },
  { href: "/escalations" as const, icon: AlertTriangle, label: "Escalations" },
  {
    href: "/slack" as const,
    icon: MessageSquareText,
    label: "Slack (simulated)",
  },
];

export function Sidebar({ appName }: { appName: string }) {
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarRoot>
      <SidebarHeader className="px-3 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <div className="min-w-0">
            <span className="block truncate font-semibold text-sm">
              {appName}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              Onboarding agents
            </span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator className="mx-0" />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <Suspense>
                <NavItems onNavigate={() => setOpenMobile(false)} />
              </Suspense>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Download the audit log as JSONL"
                >
                  <a download href="/api/audit/export">
                    <Download />
                    <span>Export audit log</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarSeparator className="mx-0" />
      <SidebarFooter>
        <form action="/api/logout" method="post">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="sm" tooltip="Sign out" type="submit">
                <LogOut />
                <span>Sign out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </form>
      </SidebarFooter>
    </SidebarRoot>
  );
}

function NavItems({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();

  return navItems.map((item) => {
    const isActive =
      item.href === "/"
        ? pathname === "/" || pathname.startsWith("/deals")
        : pathname.startsWith(item.href);
    return (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          onClick={onNavigate}
          tooltip={item.label}
        >
          <Link href={item.href}>
            <item.icon />
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  });
}
