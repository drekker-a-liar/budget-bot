'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Hammer,
  CreditCard,
  TrendingUp,
  Percent,
  Plus,
  Clock,
  Receipt,
  FileText,
  Landmark
} from 'lucide-react';
import { CardProfile, formatCents } from '@budget-bot/core';

interface NavigationProps {
  unassignedCount?: number;
  cardProfile?: CardProfile | null;
  onOpenQuickAdd?: (tab?: 'project' | 'expense' | 'labor' | 'invoice') => void;
}

export function Navigation({
  unassignedCount = 0,
  cardProfile,
  onOpenQuickAdd,
}: NavigationProps) {
  const pathname = usePathname();

  const navItems = [
    { label: 'Overview', href: '/', icon: LayoutDashboard },
    { label: 'Projects & Margins', href: '/projects', icon: Hammer },
    {
      label: 'Card Inbox',
      href: '/transactions',
      icon: CreditCard,
      badge: unassignedCount > 0 ? unassignedCount : undefined,
    },
    { label: 'Cash Flow & Runway', href: '/cashflow', icon: TrendingUp },
    { label: 'Margin', href: '/margin', icon: Percent },
    { label: 'Connections', href: '/settings/connections', icon: Landmark },
  ];

  return (
    <header style={{
      borderBottom: '1px solid var(--border-subtle)',
      background: 'rgba(10, 13, 20, 0.95)',
      backdropFilter: 'blur(8px)',
      position: 'sticky',
      top: 0,
      zIndex: 50
    }}>
      <div style={{
        maxWidth: '1360px',
        margin: '0 auto',
        padding: '0.75rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        {/* Brand & Swiss Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <Link href="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{
              width: '32px',
              height: '32px',
              background: 'var(--accent-blue)',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 900,
              fontSize: '1rem',
              color: 'var(--text-bright)'
            }}>
              BB
            </div>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-bright)' }}>
                BUDGET BOT <span style={{ color: 'var(--accent-cyan)', fontSize: '0.75rem', fontWeight: 600 }}>{'// TRADE OPS'}</span>
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Contractor Expense & Margin OS
              </div>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginLeft: '1rem' }}>
            {navItems.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    padding: '0.45rem 0.85rem',
                    borderRadius: '6px',
                    fontSize: '0.825rem',
                    fontWeight: active ? 700 : 500,
                    color: active ? 'var(--text-bright)' : 'var(--text-secondary)',
                    backgroundColor: active ? 'var(--bg-panel)' : 'transparent',
                    border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
                    textDecoration: 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Icon size={15} color={active ? 'var(--accent-cyan)' : 'currentColor'} />
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span style={{
                      background: 'var(--severity-critical)',
                      color: 'var(--text-bright)',
                      fontSize: '0.65rem',
                      fontWeight: 800,
                      padding: '0.05rem 0.4rem',
                      borderRadius: '10px',
                      marginLeft: '0.15rem'
                    }}>
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right side: Card Profile Pill + Quick Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {cardProfile && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              padding: '0.35rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.75rem'
            }}>
              <CreditCard size={14} color="var(--accent-cyan)" />
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {/* The card's own name, as the bank reported it. It used to
                      say "Spark" for everybody, which was true of one card on
                      one machine and a lie on every other deployment. */}
                  {cardProfile.cardName || cardProfile.issuer || 'Card'} ••• {cardProfile.last4}:
                </span>{' '}
                <span className="tnum" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                  {formatCents(cardProfile.currentBalanceCents)}
                </span>
              </div>
            </div>
          )}

          {/* Quick Add Menu */}
          {onOpenQuickAdd && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <button
                type="button"
                onClick={() => onOpenQuickAdd('expense')}
                className="btn-secondary"
                style={{ padding: '0.4rem 0.65rem', fontSize: '0.75rem' }}
                title="Log new card or cash receipt"
              >
                <Receipt size={13} />
                <span>+ Receipt</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenQuickAdd('labor')}
                className="btn-secondary"
                style={{ padding: '0.4rem 0.65rem', fontSize: '0.75rem' }}
                title="Log billable labor hours"
              >
                <Clock size={13} />
                <span>+ Labor</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenQuickAdd('project')}
                className="btn-primary"
                style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem' }}
                title="Create new project & budget quote"
              >
                <Plus size={14} />
                <span>+ New Project</span>
              </button>
            </div>
          )}

        </div>
      </div>
    </header>
  );
}
