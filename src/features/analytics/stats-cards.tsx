"use client";

import { CheckCircle2, XCircle, Clock, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Language } from "@/lib/translations";

interface StatsCardsProps {
  total: number;
  pass: number;
  fail: number;
  pending: number;
  lang: Language;
  onPendingClick?: () => void;
}

export function StatsCards({ total, pass, fail, pending, lang, onPendingClick }: StatsCardsProps) {
  const passRate = total > 0 ? Math.round((pass / total) * 100) : 0;
  const failRate = total > 0 ? Math.round((fail / total) * 100) : 0;
  const completionRate = total > 0 ? Math.round(((pass + fail) / total) * 100) : 0;

  const cards = [
    {
      label: lang === 'ko' ? '전체' : 'Total',
      value: total,
      icon: Users,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      sub: lang === 'ko' ? '지원자' : 'applicants',
    },
    {
      label: lang === 'ko' ? '적합' : 'Approved',
      value: pass,
      icon: CheckCircle2,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-500/10',
      sub: `${passRate}%`,
    },
    {
      label: lang === 'ko' ? '부적합' : 'Rejected',
      value: fail,
      icon: XCircle,
      color: 'text-rose-600',
      bgColor: 'bg-rose-500/10',
      sub: `${failRate}%`,
    },
    {
      label: lang === 'ko' ? '검토중' : 'Pending',
      value: pending,
      icon: Clock,
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/10',
      sub: lang === 'ko' ? `완료율 ${completionRate}%` : `${completionRate}% done`,
      onClick: pending > 0 ? onPendingClick : undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(({ label, value, icon: Icon, color, bgColor, sub, onClick }) => (
        <Card
          key={label}
          className={onClick ? 'cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all' : ''}
          onClick={onClick}
        >
          <CardContent className="flex items-center gap-3 pt-0">
            <div className={`h-10 w-10 rounded-xl ${bgColor} ${color} flex items-center justify-center shrink-0`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</p>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-2xl font-black ${color}`}>{value}</span>
                <span className="text-[10px] text-muted-foreground font-medium">{sub}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
