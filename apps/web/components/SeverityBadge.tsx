'use client';

import React from 'react';
import { SeverityLevel } from '@budget-bot/core';
import { CheckCircle2, AlertTriangle, AlertCircle, HelpCircle } from 'lucide-react';

interface SeverityBadgeProps {
  level: SeverityLevel;
  label?: string;
  subtext?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function SeverityBadge({ level, label, subtext, size = 'sm' }: SeverityBadgeProps) {
  let badgeClass = 'badge-neutral';
  let Icon = HelpCircle;
  let defaultLabel = 'UNKNOWN';

  if (level === 'healthy') {
    badgeClass = 'badge-healthy';
    Icon = CheckCircle2;
    defaultLabel = 'HEALTHY';
  } else if (level === 'caution') {
    badgeClass = 'badge-caution';
    Icon = AlertTriangle;
    defaultLabel = 'WATCH';
  } else if (level === 'critical') {
    badgeClass = 'badge-critical';
    Icon = AlertCircle;
    defaultLabel = 'CRITICAL';
  }

  const iconSize = size === 'sm' ? 12 : size === 'md' ? 14 : 16;

  return (
    <span
      className={badgeClass}
      style={{
        fontSize: size === 'sm' ? '0.68rem' : size === 'md' ? '0.75rem' : '0.85rem',
        padding: size === 'sm' ? '0.15rem 0.45rem' : '0.25rem 0.65rem',
      }}
    >
      <Icon size={iconSize} />
      <span>{label || defaultLabel}</span>
      {subtext && <span style={{ opacity: 0.8, fontWeight: 500 }}>({subtext})</span>}
    </span>
  );
}
