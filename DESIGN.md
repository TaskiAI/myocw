# myOCW Design System

---

## Colors

### Brand
| Token | Hex | Usage |
|-------|-----|-------|
| Crimson | `#750014` | Primary accent — panels, buttons, timeline, progress bars |
| Crimson (darker) | `#5a0010` | Hover state on crimson elements |
| Crimson (MIT) | `#810020` | Active nav links, gradient |
| Silver | `#C0C0C0` | Hero panel (III quadrant), flanking strips |

### Neutrals (Zinc)
| Token | Hex | Usage |
|-------|-----|-------|
| White | `#ffffff` | Light mode background, text on crimson |
| Near-black | `#171717` | Light mode foreground |
| Zinc-950 | `#09090b` | Dark mode background |
| Zinc-800 | `#27272a` | Dark mode secondary surfaces |
| Zinc-400 | `#a1a1aa` | Muted text (light) |
| Zinc-500 | `#71717a` | Muted text (dark) |

### CSS Variables
```css
--background: #ffffff  /* light */  |  #09090b  /* dark */
--foreground: #171717  /* light */  |  #ffffff   /* dark */
```

---

## Typography

### Fonts
| Variable | File | Usage |
|----------|------|-------|
| `--font-inter` | `InterVariable.woff2` | All body, UI, and most headings |
| `--font-inter-display` | `InterDisplay-Black.woff2` (weight 900) | Reserved for display use |

Both are loaded locally from `public/fonts/` via `next/font/local`. Not from Google Fonts.

### Font Smoothing (applied globally via `html`)
```css
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
font-smooth: never;
```

### Scale
| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero H1 | 110px | 700 (bold) | 104% | -0.07em |
| CTA Heading | 64px | 700 (bold) | 110% | -0.05em |
| Section Title | 56px | 700 (bold) | 110% | -0.05em |
| Feature Title | 24px (2xl) | 700 (bold) | auto | -0.03em |
| Body | 16px (base) | 400 | relaxed | auto |
| Small / Meta | 14px (sm) | 400–500 | auto | auto |
| Attribution | 12px (xs) | 400 | auto | auto |

### Text Rendering (hero headings)
```js
WebkitFontSmoothing: "antialiased"
MozOsxFontSmoothing: "grayscale"
textRendering: "geometricPrecision"
```

---

## Motion

### Easing
One easing curve used across the entire product:
```js
[0.25, 0.1, 0.25, 1]  // custom ease-out cubic-bezier
```

### Durations
| Context | Duration |
|---------|----------|
| Hero text cascade (per line) | 0.5s |
| Panel accordion (crimson/silver) | 0.45s |
| Image enter | 0.6s |
| Feature card enter | 0.5s |
| Timeline dot pop | 0.3s |
| Hover transitions | 200ms |
| Navbar entrance | 0.4s |

### Stagger Patterns
- Hero text lines: 0.1s between each line
- Feature timeline cards: viewport-triggered individually
- CTA images: 0.12s between each image

### Scroll Animations
- Feature timeline: crimson progress line tracks `scrollYProgress` (`useScroll`, target container)
- CTA images: x-axis parallax ±25px mapped to `scrollYProgress`
- Viewport margin for early trigger: `-80px` (features), `0px` (images)

### Hero Animation Timeline
```
0.00s  Text #1 cascades ("2,500 Courses / from MIT")
0.70s  Crimson panel expands right (center → right edge)
1.25s  Text #2 cascades ("Anywhere in / the World")
1.95s  Silver panel expands left (center → left edge)
2.50s  Text #3 cascades ("Completely / Yours")
```

---

## Layout

### Breakpoints
Tailwind defaults (`sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px, `2xl` 1536px).

### Containers
| Context | Max Width |
|---------|-----------|
| Navbar | `max-w-screen-2xl` |
| Course browser, dashboard | `max-w-6xl` |
| Feature timeline | `max-w-4xl` |
| Landing CTA | `max-w-7xl` |

### Hero Grid
Full viewport (`h-[calc(100vh-5rem)]`), divided into quadrants:
- **I (top-left):** White — primary heading
- **II (right):** Crimson — secondary heading, vertically centered
- **III (bottom-left):** Silver — tertiary heading
- **IV (bottom-right):** Part of crimson panel

### Navbar
- Height: `h-20` (80px)
- Fixed, `z-50`, `backdrop-blur-md` at 80% opacity
- `pt-20` on `<body>` to offset

---

## Components

### Buttons
```
Primary (crimson):  bg-[#750014] text-white px-6 py-3  hover:bg-[#5a0010]
CTA (black):        bg-black text-white px-10 py-5     hover:bg-zinc-800
Secondary (outline): border border-zinc-300 px-6 py-3  hover:bg-zinc-50
```
No border radius on CTA buttons (sharp corners). `rounded-lg` on standard buttons.

### Cards
- `rounded-xl`, `border border-zinc-200 dark:border-zinc-800`
- `shadow-sm` default, `shadow-md` on hover
- `scale-[1.02]` on hover, `transition-all duration-200`
- Image: `aspect-video` (16:9), `object-cover`
- Progress bar: `h-1.5 rounded-full bg-[#750014]`

### Timeline
- Center vertical line: `1px` zinc-200/zinc-800
- Animated crimson progress line overlaid
- Dots: `w-4 h-4 rounded-full bg-[#750014] ring-4 ring-white dark:ring-zinc-950`
- Cards alternate left/right, slide in from respective side

### Feature Timeline Flanking Panels
Left panel: Silver (`#C0C0C0`) — width = `calc((100% - 56rem) / 2)`
Right panel: Crimson (`#750014`) — same width
Both are static (no scroll animation), fill full section height.

---

## Dark Mode

- Strategy: class-based (`.dark` on `<html>`) with `localStorage` persistence
- Detected on first load via inline script before paint (no flash)
- Custom Tailwind variant: `@variant dark (&:where(.dark, .dark *))`
- Zinc-950 (`#09090b`) background, white text
- Crimson remains identical in both modes
- Silver panel only appears on the landing page (unauthenticated)

---

## Images

All served from `public/` via `next/image` with `priority` on above-fold images.

| File | Usage |
|------|-------|
| `mit.jpg` | Hero background (5376×2130, full-viewport) |
| `cambridge_1–6` | CTA section staggered collage |
| `dome_outside 1.svg` | (Unused in current design) |
| `InterVariable.woff2` | Body font |
| `InterDisplay-Black.woff2` | Display font |
