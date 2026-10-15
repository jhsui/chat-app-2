import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, Moon, Sun, SunMoon } from "lucide-react";
import { cx, ui } from "./ui.ts";
import FloatingMenu from "./components/FloatingMenu.tsx";

type Theme = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";
/** Also read by the inline script in index.html, which applies it before the first paint. */
const THEME_KEY = "chat-theme";
/** The look on a first visit, before anything has been picked. */
const DEFAULT_THEME: Theme = "dark";
const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: SunMoon },
] as const;

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark" || value === "system")
      return value;
  } catch {
    /* Appearance remains available without local storage. */
  }
  return DEFAULT_THEME;
}
function systemTheme(): ResolvedTheme {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
const initialTheme = storedTheme();
document.documentElement.dataset.theme =
  initialTheme === "system" ? systemTheme() : initialTheme;

const ThemeContext = createContext<{
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}>({ theme: DEFAULT_THEME, resolvedTheme: "dark", setTheme: () => {} });
export function useAppearance() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(storedTheme);
  const [deviceTheme, setDeviceTheme] = useState<ResolvedTheme>(systemTheme);
  const resolvedTheme = theme === "system" ? deviceTheme : theme;

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const updateDevice = () => setDeviceTheme(systemTheme());
    const syncPreference = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null)
        updateTheme(storedTheme());
    };
    media.addEventListener("change", updateDevice);
    window.addEventListener("storage", syncPreference);
    return () => {
      media.removeEventListener("change", updateDevice);
      window.removeEventListener("storage", syncPreference);
    };
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    // The browser's own bars (e.g. the status bar in mobile Safari) take the
    // page background's colour, read from styles.css so they never disagree.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        getComputedStyle(root).getPropertyValue("--app-bg").trim(),
      );
  }, [resolvedTheme]);

  function setTheme(next: Theme) {
    updateTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Optional preference persistence. */
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeButton() {
  const { theme, resolvedTheme, setTheme } = useAppearance();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  // The look that's showing right now, also when it comes from "System".
  const Icon = resolvedTheme === "dark" ? Moon : Sun;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={cx(
          ui.iconBtn,
          "size-9",
          // "!" so these beat the gray text in ui.iconBtn.
          open && "bg-panel-2! text-fg!",
        )}
        onClick={() => setOpen(!open)}
        aria-label="Appearance"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Appearance: ${theme}`}
      >
        <Icon className="size-4.5" />
      </button>
      {open && anchorRef.current && (
        <FloatingMenu
          anchor={anchorRef.current}
          label="Appearance"
          width={180}
          onClose={() => setOpen(false)}
        >
          {themeOptions.map(({ value, label, icon: OptionIcon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === value}
              className="menu-action"
              onClick={() => {
                setTheme(value);
                setOpen(false);
                anchorRef.current?.focus({ preventScroll: true });
              }}
            >
              <OptionIcon className="size-4 flex-none text-muted" />
              <span className="flex-1">{label}</span>
              {theme === value && <Check className="size-4 text-accent" />}
            </button>
          ))}
        </FloatingMenu>
      )}
    </>
  );
}
