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
const THEME_KEY = "chat-theme";
const themeOptions = [
  { value: "light", label: "Light", detail: "A fresh perspective", icon: Sun },
  { value: "dark", label: "Dark", detail: "Easy on the eyes", icon: Moon },
  {
    value: "system",
    label: "System",
    detail: "Follow your device",
    icon: SunMoon,
  },
] as const;

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    /* Appearance remains available without local storage. */
  }
  return "system";
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
}>({ theme: "system", resolvedTheme: systemTheme(), setTheme: () => {} });
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
    document.documentElement.dataset.theme = resolvedTheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        resolvedTheme === "dark" ? "#131c2c" : "#ffffff",
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
          "size-11",
          // "!" so these beat the gray text and hover background in ui.iconBtn.
          open && "bg-accent-soft! text-accent!",
        )}
        onClick={() => setOpen(!open)}
        aria-label="Appearance"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Appearance: ${theme}`}
      >
        <Icon className="size-[18px]" />
      </button>
      {open && anchorRef.current && (
        <FloatingMenu
          anchor={anchorRef.current}
          label="Appearance"
          width={248}
          onClose={() => setOpen(false)}
        >
          <p className="eyebrow px-3 pt-2 pb-3">Make it your space</p>
          {themeOptions.map(({ value, label, detail, icon: OptionIcon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === value}
              className={cx(
                "flex min-h-14 w-full items-center gap-3 rounded-[18px] px-3 py-2 text-left transition hover:bg-panel-2 active:scale-[0.97]",
                theme === value && "bg-accent-soft",
              )}
              onClick={() => {
                setTheme(value);
                setOpen(false);
                anchorRef.current?.focus({ preventScroll: true });
              }}
            >
              <OptionIcon
                className={cx(
                  "size-[18px] flex-none",
                  theme === value ? "text-accent" : "text-muted",
                )}
              />
              <span className="flex-1">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-xs text-muted">{detail}</span>
              </span>
              {theme === value && <Check className="size-4 text-accent" />}
            </button>
          ))}
        </FloatingMenu>
      )}
    </>
  );
}
