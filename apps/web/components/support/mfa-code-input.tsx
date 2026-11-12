"use client"

import { useRef } from "react"

import { cn } from "@/lib/utils"

const LENGTH = 6

/**
 * Campo de código de 6 dígitos (autenticador): avança sozinho, aceita colar e apagar com Backspace.
 * `value` tem posições vazias como espaço; está completo quando casa com /^\d{6}$/.
 */
export function MfaCodeInput({
  value,
  onChange,
  onComplete,
  invalid,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  onComplete?: (v: string) => void
  invalid?: boolean
  disabled?: boolean
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length: LENGTH }, (_, i) => (value[i] && value[i] !== " " ? value[i]! : ""))
  const emit = (arr: string[]) => {
    const next = arr.map((c) => c || " ").join("")
    onChange(next)
    return next
  }

  function focus(i: number) {
    refs.current[Math.max(0, Math.min(LENGTH - 1, i))]?.focus()
  }

  function setAt(i: number, chars: string) {
    const clean = chars.replace(/\D/g, "")
    if (!clean) return
    const arr = digits.slice()
    for (let k = 0; k < clean.length && i + k < LENGTH; k++) arr[i + k] = clean[k]!
    const next = emit(arr)
    focus(i + clean.length)
    if (/^\d{6}$/.test(next)) onComplete?.(next)
  }

  return (
    <div className="flex justify-center gap-1.5 sm:gap-2" role="group" aria-label="Código de verificação de 6 dígitos">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={LENGTH}
          aria-label={`Dígito ${i + 1}`}
          aria-invalid={invalid}
          autoFocus={i === 0}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const v = e.target.value
            // Cursor sem seleção: "5" + "7" = "57" → fica só o dígito novo.
            setAt(i, d && v.length === 2 ? v.replace(d, "") || d : v.slice(-LENGTH))
          }}
          onPaste={(e) => {
            e.preventDefault()
            setAt(i, e.clipboardData.getData("text"))
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault()
              const arr = digits.slice()
              if (arr[i]) {
                arr[i] = ""
                emit(arr)
              } else if (i > 0) {
                arr[i - 1] = ""
                emit(arr)
                focus(i - 1)
              }
            } else if (e.key === "ArrowLeft") focus(i - 1)
            else if (e.key === "ArrowRight") focus(i + 1)
          }}
          className={cn(
            "h-12 w-10 rounded-xl border border-input bg-background text-center font-mono text-xl font-semibold tabular-nums shadow-xs transition outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 sm:h-14 sm:w-12",
            d && "border-primary/50",
            invalid && "border-destructive ring-destructive/20",
            i === 2 && "mr-2 sm:mr-3",
          )}
        />
      ))}
    </div>
  )
}
