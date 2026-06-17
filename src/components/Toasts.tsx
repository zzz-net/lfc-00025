import useQCStore from '@/store';
import { CheckCircle2, XCircle, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const icons = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
};

const colorMap = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};

const iconColor = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};

export default function Toasts() {
  const toasts = useQCStore((s) => s.toasts);
  const remove = useQCStore((s) => s.removeToast);

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-80 max-w-[92vw]">
      {toasts.map((t) => {
        const Icon = icons[t.type];
        return (
          <div
            key={t.id}
            className={cn(
              'flex items-start gap-3 px-4 py-3 rounded-xl border shadow-card backdrop-blur animate-fade-in',
              colorMap[t.type],
            )}
          >
            <Icon className={cn('w-5 h-5 shrink-0 mt-0.5', iconColor[t.type])} />
            <p className="text-sm font-medium flex-1 leading-snug">{t.message}</p>
            <button
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              onClick={() => remove(t.id)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
