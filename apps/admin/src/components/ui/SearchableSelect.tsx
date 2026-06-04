'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

export type SearchableSelectOption<T extends string = string> = {
  value: T;
  label: string;
  subLabel?: string | null;
  searchText: string;
};

type SearchableSelectProps<T extends string = string> = {
  value: T | '';
  onChange: (value: T) => void;
  options: SearchableSelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingPlaceholder?: string;
  noResultsMessage?: string;
  id?: string;
};

export function SearchableSelect<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Seleccionar…',
  disabled = false,
  loading = false,
  loadingPlaceholder = 'Cargando…',
  noResultsMessage = 'Sin resultados',
  id,
}: SearchableSelectProps<T>) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const listboxId = `${inputId}-listbox`;

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matches = normalized
      ? options.filter((option) => option.searchText.toLowerCase().includes(normalized))
      : options;

    return [...matches].sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setHighlightIndex(0);
    }
  }, [open, query]);

  function openDropdown() {
    if (disabled || loading) return;
    setOpen(true);
    setQuery('');
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function selectOption(option: SearchableSelectOption<T>) {
    onChange(option.value);
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setQuery('');
      return;
    }

    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      event.preventDefault();
      openDropdown();
      return;
    }

    if (!open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((current) =>
        filteredOptions.length === 0 ? 0 : (current + 1) % filteredOptions.length,
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((current) =>
        filteredOptions.length === 0
          ? 0
          : (current - 1 + filteredOptions.length) % filteredOptions.length,
      );
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const option = filteredOptions[highlightIndex];
      if (option) selectOption(option);
    }
  }

  const displayValue = open ? query : selected?.label ?? '';

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        value={displayValue}
        placeholder={loading ? loadingPlaceholder : placeholder}
        disabled={disabled || loading}
        onFocus={openDropdown}
        onClick={openDropdown}
        onChange={(event) => {
          setQuery(event.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className="ui-input w-full"
      />

      {open && !loading ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto overflow-x-hidden rounded-xl border border-white/10 bg-[#101010] py-1 shadow-xl shadow-black/40"
        >
          {filteredOptions.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-white/35">{noResultsMessage}</li>
          ) : (
            filteredOptions.map((option, index) => {
              const highlighted = index === highlightIndex;
              return (
                <li key={option.value} role="option" aria-selected={option.value === value}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlightIndex(index)}
                    onClick={() => selectOption(option)}
                    className={`flex w-full flex-col items-start px-3 py-2.5 text-left transition ${
                      highlighted ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'
                    }`}
                  >
                    <span className="text-sm font-medium text-white">{option.label}</span>
                    {option.subLabel ? (
                      <span className="mt-0.5 text-xs text-white/40">{option.subLabel}</span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
