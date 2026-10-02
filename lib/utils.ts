import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function cleanSlackText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/<@[A-Z0-9]+>/g, '')
    .replace(/@U[A-Z0-9]{8,}/g, '')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<#([^>|]+)>/g, '#$1')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .trim();
}

export function stripMarkdown(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\n{2,}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
