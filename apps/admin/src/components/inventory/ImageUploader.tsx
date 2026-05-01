'use client';

import { useRef, useState } from 'react';

import { apiGet, ApiError } from '@/lib/api-client';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

type UploadSignature = {
  signature: string;
  timestamp: number;
  cloudName: string;
  apiKey: string;
  folder: string;
};

type Props = {
  value: string;
  onChange: (url: string) => void;
};

async function uploadToCloudinary(file: File, sig: UploadSignature): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  body.append('api_key', sig.apiKey);
  body.append('timestamp', String(sig.timestamp));
  body.append('signature', sig.signature);
  body.append('folder', sig.folder);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
    { method: 'POST', body },
  );

  const data = (await res.json()) as { secure_url?: string; error?: { message?: string } };

  if (!res.ok || !data.secure_url) {
    throw new Error(data.error?.message ?? 'Upload failed. Please try again.');
  }

  return data.secure_url;
}

export function ImageUploader({ value, onChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);

    if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) {
      setError('Only JPG, PNG, and WEBP images are accepted.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Image must be smaller than 5 MB.');
      return;
    }

    setUploading(true);
    try {
      const sig = await apiGet<UploadSignature>('/inventory/upload-signature', {
        authenticated: true,
      });
      const url = await uploadToCloudinary(file, sig);
      onChange(url);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Upload failed. Please try again.';
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const openPicker = () => {
    if (!uploading) inputRef.current?.click();
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="flex items-start gap-4">
          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/15">
            <img
              src={value}
              alt="Watch photo"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            {uploading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={openPicker}
              disabled={uploading}
              className="ui-btn-secondary px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Replace'}
            </button>
            <button
              type="button"
              onClick={() => { onChange(''); setError(null); }}
              disabled={uploading}
              className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          disabled={uploading}
          className={[
            'relative flex w-full flex-col items-center justify-center gap-2',
            'rounded-xl border-2 border-dashed px-4 py-8 text-center',
            'transition-colors duration-150 disabled:pointer-events-none',
            dragOver
              ? 'border-accent bg-accent/10'
              : 'border-white/15 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04]',
          ].join(' ')}
        >
          {uploading ? (
            <>
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              <p className="text-sm text-muted">Uploading…</p>
            </>
          ) : (
            <>
              <svg
                className="h-6 w-6 text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-white">
                  Drop image or{' '}
                  <span className="text-accent underline underline-offset-2">click to select</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">JPG, PNG, WEBP · Max 5 MB</p>
              </div>
            </>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={onInputChange}
      />

      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
