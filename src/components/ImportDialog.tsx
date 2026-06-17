import { useState, useRef, useCallback } from 'react';
import useQCStore from '@/store';
import {
  X, Upload, File, CheckCircle2, AlertTriangle, XCircle,
  FileSpreadsheet, Loader2, Info, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface VerifyResult {
  valid?: boolean;
  rows?: number;
  sensors?: string[];
  errors?: { row: number; message: string }[];
  warnings?: { row: number; message: string }[];
}

export default function ImportDialog({
  open, onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const uploadFile = useQCStore((s) => s.uploadFile);
  const importing = useQCStore((s) => s.loading.import);
  const addToast = useQCStore((s) => s.addToast);

  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFile(null);
    setVerifyResult(null);
    setDragOver(false);
  };

  const doVerify = useCallback(async (f: File) => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const { api } = await import('@/lib/api.js');
      const r = await api.import.verify(f);
      setVerifyResult(r.data as any);
    } catch (e: any) {
      setVerifyResult({ valid: false, errors: [{ row: 0, message: '校验失败: ' + e.message }] });
    } finally {
      setVerifying(false);
    }
  }, []);

  const handleFile = (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'json', 'txt'].includes(ext || '')) {
      addToast({ type: 'error', message: '仅支持 CSV / JSON / TXT 格式' });
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      addToast({ type: 'error', message: '文件大小不能超过 20MB' });
      return;
    }
    setFile(f);
    void doVerify(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const doImport = async () => {
    if (!file || importing) return;
    if (verifyResult && !verifyResult.valid && (verifyResult.errors?.length || 0) > 0) {
      addToast({ type: 'warning', message: '存在错误行，将跳过错误行后导入' });
    }
    await uploadFile(file);
    onClose();
    reset();
  };

  if (!open) return null;

  const fileIcon = (() => {
    if (!file) return null;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'csv' || ext === 'txt') return <FileSpreadsheet className="w-5 h-5 text-accent-blue" />;
    return <File className="w-5 h-5 text-accent-violet" />;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-slateqc-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-card animate-slide-in-right overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slateqc-100">
          <div>
            <h3 className="text-base font-bold text-slateqc-900 flex items-center gap-2">
              <Upload className="w-4 h-4 text-accent-blue" />
              导入传感器数据
            </h3>
            <p className="text-xs text-slateqc-500 mt-0.5">支持 CSV / JSON / TXT 格式</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slateqc-100 text-slateqc-400 hover:text-slateqc-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {!file ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all',
                dragOver
                  ? 'border-accent-blue bg-accent-blue/5 scale-[1.01]'
                  : 'border-slateqc-200 hover:border-slateqc-300 hover:bg-slateqc-50',
              )}
            >
              <div className="w-14 h-14 mx-auto rounded-2xl bg-slateqc-50 border border-slateqc-100 flex items-center justify-center mb-4">
                <Upload className="w-6 h-6 text-slateqc-400" />
              </div>
              <p className="text-sm font-semibold text-slateqc-700">
                拖放文件到此处，或<u className="text-accent-blue">点击选择</u>
              </p>
              <p className="text-xs text-slateqc-400 mt-2">
                文件格式：CSV / JSON / TXT，最大 20MB
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.json,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-slateqc-50 rounded-xl border border-slateqc-100">
                <div className="w-10 h-10 rounded-lg bg-white border border-slateqc-200 flex items-center justify-center shrink-0">
                  {fileIcon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slateqc-800 truncate">{file.name}</p>
                  <p className="text-xs text-slateqc-500 mt-0.5">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <button
                  onClick={reset}
                  className="p-2 rounded-lg hover:bg-white text-slateqc-400 hover:text-slateqc-700"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {verifying && (
                <div className="flex items-center gap-2 p-4 bg-accent-blue/5 rounded-xl border border-accent-blue/20">
                  <Loader2 className="w-4 h-4 text-accent-blue animate-spin" />
                  <p className="text-xs font-medium text-accent-blue">正在校验文件格式...</p>
                </div>
              )}

              {verifyResult && !verifying && (
                <div className="space-y-3 max-h-64 overflow-y-auto scrollbar-thin">
                  <div className="flex flex-wrap gap-2">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slateqc-50 border border-slateqc-200 text-xs">
                      <File className="w-3.5 h-3.5 text-slateqc-500" />
                      <span className="text-slateqc-500">行数</span>
                      <span className="font-bold text-slateqc-800">{verifyResult.rows || 0}</span>
                    </div>
                    {verifyResult.sensors && verifyResult.sensors.length > 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-cyan/10 border border-accent-cyan/30 text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5 text-accent-cyan" />
                        <span className="text-accent-cyan/80">传感器</span>
                        <span className="font-bold text-accent-cyan">{verifyResult.sensors.length} 台</span>
                      </div>
                    )}
                    {verifyResult.valid !== false ? (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700 font-semibold">校验通过</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-xs">
                        <XCircle className="w-3.5 h-3.5 text-rose-600" />
                        <span className="text-rose-700 font-semibold">发现错误</span>
                      </div>
                    )}
                  </div>

                  {verifyResult.errors && verifyResult.errors.length > 0 && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 space-y-1.5">
                      <p className="text-[11px] font-bold text-rose-700 flex items-center gap-1">
                        <XCircle className="w-3 h-3" />
                        错误 ({verifyResult.errors.length} 行，将被跳过)
                      </p>
                      <div className="space-y-1 max-h-28 overflow-y-auto scrollbar-thin">
                        {verifyResult.errors.slice(0, 8).map((e, i) => (
                          <p key={i} className="text-[11px] text-rose-600 flex gap-2">
                            <span className="shrink-0 font-mono font-semibold text-rose-500">R{e.row}</span>
                            <span>{e.message}</span>
                          </p>
                        ))}
                        {verifyResult.errors.length > 8 && (
                          <p className="text-[11px] text-rose-500">...还有 {verifyResult.errors.length - 8} 条错误</p>
                        )}
                      </div>
                    </div>
                  )}

                  {verifyResult.warnings && verifyResult.warnings.length > 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 space-y-1.5">
                      <p className="text-[11px] font-bold text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        警告 ({verifyResult.warnings.length} 条)
                      </p>
                      <div className="space-y-1 max-h-20 overflow-y-auto scrollbar-thin">
                        {verifyResult.warnings.slice(0, 5).map((w, i) => (
                          <p key={i} className="text-[11px] text-amber-700 flex gap-2">
                            <span className="shrink-0 font-mono font-semibold text-amber-600">R{w.row}</span>
                            <span>{w.message}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="p-3 rounded-xl bg-accent-blue/5 border border-accent-blue/15 flex gap-2.5">
            <Info className="w-4 h-4 text-accent-blue shrink-0 mt-0.5" />
            <div className="text-[11px] text-accent-blue/90 leading-relaxed space-y-0.5">
              <p className="font-bold">CSV 格式说明：</p>
              <p>需要包含：<code className="bg-white/70 px-1 rounded">timestamp</code>(时间)、<code className="bg-white/70 px-1 rounded">sensor_id</code>(设备号)、<code className="bg-white/70 px-1 rounded">temperature</code>(温度)、<code className="bg-white/70 px-1 rounded">humidity</code>(湿度)</p>
              <p className="text-accent-blue/70">支持中英文表头（设备编号/温度/湿度），非法行会被自动跳过。</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slateqc-100 bg-slateqc-50/50">
          <button
            onClick={() => { onClose(); reset(); }}
            className="btn-ghost text-xs"
          >
            取消
          </button>
          <button
            onClick={doImport}
            disabled={!file || importing || verifying}
            className={cn(
              'btn-primary text-xs flex items-center gap-1.5',
              (!file || importing || verifying) && 'opacity-50 cursor-not-allowed',
            )}
          >
            {importing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            {importing ? '导入中...' : '开始导入'}
          </button>
        </div>
      </div>
    </div>
  );
}
