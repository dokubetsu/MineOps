'use client'

/**
 * Combobox: pick existing transport contractor or type a new name.
 * Parent stores free-text `value` (name); resolve to id on save via resolveOrCreateContractorId.
 */

import { useId } from 'react'

type Contractor = { id: string; name: string }

export default function ContractorInput({
  value,
  onChange,
  contractors,
  required = false,
  placeholder = 'Type name or pick from list',
  label,
  hint = 'Pick from list or type a new contractor name',
  disabled = false,
}: {
  value: string
  onChange: (name: string) => void
  contractors: Contractor[]
  required?: boolean
  placeholder?: string
  label?: string
  hint?: string
  disabled?: boolean
}) {
  const listId = useId().replace(/:/g, '') + '-contractors'

  return (
    <div className="form-group">
      {label != null && (
        <label className="form-label" htmlFor={listId + '-input'}>
          {label}
          {required ? ' *' : ''}
        </label>
      )}
      <input
        id={listId + '-input'}
        className="form-input"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        required={required}
        disabled={disabled}
      />
      <datalist id={listId}>
        {contractors.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      {hint && (
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{hint}</span>
      )}
    </div>
  )
}
