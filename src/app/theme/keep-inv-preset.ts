import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

/*
 * "The Lit Workbench" PrimeNG preset.
 * Warm-tinted neutral surfaces (never pure #fff/#000) carrying a single amber
 * signal as the primary color. Mirrors the Tailwind @theme tokens in styles.css
 * so PrimeNG components and hand-built markup share one visual language.
 */
export const KeepInvPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: 'oklch(97% 0.02 80)',
      100: 'oklch(94% 0.04 80)',
      200: 'oklch(90% 0.07 78)',
      300: 'oklch(85% 0.1 77)',
      400: 'oklch(78% 0.13 76)',
      500: 'oklch(72% 0.15 75)',
      600: 'oklch(66% 0.155 75)',
      700: 'oklch(58% 0.14 73)',
      800: 'oklch(50% 0.12 70)',
      900: 'oklch(43% 0.1 68)',
      950: 'oklch(33% 0.08 65)',
    },
    focusRing: {
      width: '2px',
      style: 'solid',
      color: '{primary.color}',
      offset: '2px',
    },
    formField: {
      paddingX: '0.75rem',
      paddingY: '0.5rem',
      borderRadius: '0.375rem',
      focusRing: {
        width: '2px',
        style: 'solid',
        color: '{primary.color}',
        offset: '0',
        shadow: 'none',
      },
    },
    colorScheme: {
      light: {
        primary: {
          color: '{primary.500}',
          contrastColor: 'oklch(24% 0.014 75)',
          hoverColor: '{primary.600}',
          activeColor: '{primary.700}',
        },
        surface: {
          0: 'oklch(99% 0.003 75)',
          50: 'oklch(98% 0.006 75)',
          100: 'oklch(95% 0.007 75)',
          200: 'oklch(90% 0.008 75)',
          300: 'oklch(84% 0.009 75)',
          400: 'oklch(72% 0.011 75)',
          500: 'oklch(62% 0.013 75)',
          600: 'oklch(50% 0.014 75)',
          700: 'oklch(44% 0.014 75)',
          800: 'oklch(34% 0.014 75)',
          900: 'oklch(28% 0.014 75)',
          950: 'oklch(24% 0.014 75)',
        },
        formField: {
          background: '{surface.0}',
          borderColor: '{surface.500}',
          hoverBorderColor: '{surface.600}',
          focusBorderColor: '{primary.color}',
          invalidBorderColor: 'oklch(52% 0.17 27)',
          color: '{surface.950}',
          placeholderColor: '{surface.600}',
        },
        text: {
          color: '{surface.950}',
          mutedColor: '{surface.600}',
        },
      },
    },
  },
  components: {
    /*
     * Paginators live inside narrow (21-28rem) master-list panes. Keep nav
     * buttons compact so the full control fits on one line, and honour the One
     * Signal Rule: the selected page is the amber signal, not a pale tint.
     */
    paginator: {
      root: {
        padding: '0.5rem',
        gap: '0.125rem',
      },
      navButton: {
        width: '2.25rem',
        height: '2.25rem',
        borderRadius: '0.375rem',
        selectedBackground: '{primary.color}',
        selectedColor: '{primary.contrastColor}',
      },
    },
  },
});
