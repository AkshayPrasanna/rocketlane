import {
  AlertTriangle,
  ArrowRightLeft,
  MessageSquare,
  Search,
  UserPlus,
} from "lucide-react";
import type { BotAction } from "@/lib/types";

export interface TypeConfigEntry {
  bgColor: string;
  icon: typeof MessageSquare;
  iconColor: string;
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
}

export const typeConfig: Record<BotAction["type"], TypeConfigEntry> = {
  answered: {
    icon: MessageSquare,
    label: "Answered",
    variant: "default",
    iconColor: "text-type-answered",
    bgColor: "bg-type-answered/10",
  },
  routed: {
    icon: ArrowRightLeft,
    label: "Routed",
    variant: "outline",
    iconColor: "text-type-routed",
    bgColor: "bg-type-routed/10",
  },
  welcomed: {
    icon: UserPlus,
    label: "Welcomed",
    variant: "secondary",
    iconColor: "text-type-welcomed",
    bgColor: "bg-type-welcomed/10",
  },
  surfaced: {
    icon: Search,
    label: "Surfaced",
    variant: "outline",
    iconColor: "text-type-surfaced",
    bgColor: "bg-type-surfaced/10",
  },
  flagged: {
    icon: AlertTriangle,
    label: "Flagged",
    variant: "destructive",
    iconColor: "text-type-flagged",
    bgColor: "bg-type-flagged/10",
  },
};
