/**
 * Design tokens for the plugin's admin components.
 *
 * Payload 4 retired the `--theme-*` colors, `--base`, `--style-radius-*` and the
 * SCSS-era font-size variables in favor of semantic `--color-*`, `--radius-*` and
 * `--text-*` tokens. Every inline style in `src/components` goes through this
 * module, so a change in Payload's token names is a change to this one file.
 *
 * The color tokens are redefined by Payload under `[data-theme='dark']`, so the
 * components follow the admin's light/dark theme without any extra work.
 */

export const color = {
  /** Page background behind the auth card. */
  bg: 'var(--color-bg)',
  /** Cards and panels that sit on the page background. */
  surface: 'var(--color-bg-secondary)',
  /** Chips, code blocks and neutral buttons inside a card. */
  surfaceRaised: 'var(--color-bg-tertiary)',
  /** Neutral button that is switched on (e.g. a selected permission). */
  surfaceSelected: 'var(--color-bg-selected)',
  /** Primary button background, and the text that sits on it. */
  inverse: 'var(--color-bg-inverse)',
  onInverse: 'var(--color-text-oninverse)',

  text: 'var(--color-text)',
  textMuted: 'var(--color-text-secondary)',
  border: 'var(--color-border)',

  inputBg: 'var(--field-color-bg)',
  inputBorder: 'var(--field-color-border)',

  danger: 'var(--color-text-danger)',
  dangerBg: 'var(--color-bg-danger-tertiary)',
  dangerBorder: 'var(--color-border-danger)',
  success: 'var(--color-text-success)',
  successBg: 'var(--color-bg-success-tertiary)',
  successBorder: 'var(--color-border-success)',
  warning: 'var(--color-text-warning)',
} as const

export const radius = {
  /** Inputs, buttons, chips. Matches Payload's own fields and buttons. */
  small: 'var(--radius-medium)',
  /** Cards and panels. */
  medium: 'var(--radius-large)',
} as const

export const font = {
  small: 'var(--text-body-medium-font-size)',
  base: 'var(--text-body-large-font-size)',
  h4: 'var(--text-heading-medium-font-size)',
  h3: 'var(--text-heading-large-font-size)',
  h2: 'var(--text-heading-xl-font-size)',
} as const

/**
 * Spacing in multiples of Payload 3's 20px `--base` unit, which the components
 * were laid out with. Payload 4 has no 20px step (its spacers go 16px → 24px),
 * so the unit lives here rather than being rounded to the nearest spacer.
 */
export function space(multiplier: number = 1): string {
  return multiplier === 1 ? '1.25rem' : `calc(1.25rem * ${multiplier})`
}
