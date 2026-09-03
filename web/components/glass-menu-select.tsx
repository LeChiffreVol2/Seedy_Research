"use client";

import type { LucideIcon } from "lucide-react";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type GlassMenuOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  badge?: string;
};

export function GlassMenuSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  icon: Icon,
  className = "",
  align = "left",
}: {
  label: string;
  value: T;
  options: ReadonlyArray<GlassMenuOption<T>>;
  onChange: (value: T) => void;
  icon?: LucideIcon;
  className?: string;
  align?: "left" | "right";
}) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const items = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']");
      items?.[Math.max(0, Math.min(selectedIndex, (items?.length ?? 1) - 1))]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, selectedIndex]);

  const openMenu = () => {
    setOpen(true);
  };

  const closeMenu = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div className={`glassMenuSelect ${className}`} data-dropdown-root>
      <span className="glassWrap glassSelectWrap">
        <button
          ref={triggerRef}
          type="button"
          className="glassButton glassSelectTrigger"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => open ? closeMenu(false) : openMenu()}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              event.preventDefault();
              closeMenu();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (!open) openMenu();
            }
          }}
        >
          {Icon ? <Icon className="controlIcon" aria-hidden /> : null}
          <span className="glassSelectCopy">
            <span>{label}</span>
            <strong>{selected?.label ?? value}</strong>
          </span>
          <ChevronDown className={`chevronIcon ${open ? "open" : ""}`} aria-hidden />
        </button>
      </span>

      {open ? (
        <>
          <div className="dropdownDismissLayer" aria-hidden onPointerDown={() => closeMenu(false)} />
          <div className={`glassDropdown glassSelectDropdown ${align === "right" ? "right" : ""}`}>
            <div className="dropdownSurface">
              <div className="menuTitle">{label}</div>
              <div
                ref={menuRef}
                id={menuId}
                className="menuOptions"
                role="menu"
                aria-label={label}
                onKeyDown={(event) => {
                  const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? []);
                  const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
                  if (event.key === "Escape" || event.key === "Tab") {
                    if (event.key === "Escape") event.preventDefault();
                    closeMenu(event.key === "Escape");
                  } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
                    event.preventDefault();
                    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
                    items[next]?.focus();
                  }
                }}
              >
                {options.map((option) => {
                  const isSelected = option.value === value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      className={`menuOption ${isSelected ? "selected" : ""}`}
                      aria-checked={isSelected}
                      onClick={() => {
                        onChange(option.value);
                        closeMenu();
                      }}
                    >
                      <span>
                        <span className="optionLabel">{option.label}{option.badge ? <small className="optionBadge">{option.badge}</small> : null}</span>
                        {option.description ? <span className="optionDescription">{option.description}</span> : null}
                      </span>
                      <span className="checkMark" aria-hidden>{isSelected ? <Check size={15} strokeWidth={2.6} /> : null}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
