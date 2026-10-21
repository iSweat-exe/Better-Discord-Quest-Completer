import { createElement, useEffect, useRef, type ForwardRefExoticComponent, type RefAttributes } from "react";

import type { IconHandle, IconProps } from "./types";

/**
 * What a pointer must be over to play an icon: the control the icon belongs to,
 * so a whole button reacts and not just the few pixels of its icon.
 */
const SCOPE = 'button, a, summary, label, [role="option"], [role="radio"], [data-icon-scope]';

type AnimatedIcon = ForwardRefExoticComponent<IconProps & RefAttributes<IconHandle>>;

/**
 * Makes an animated icon play while the pointer is over the control around it
 * (or over the icon itself when it sits in no control).
 */
export function withHoverScope(Icon: AnimatedIcon, name: string) {
  function ScopedIcon(props: IconProps) {
    const root = useRef<HTMLSpanElement>(null);
    const icon = useRef<IconHandle>(null);

    useEffect(() => {
      const element = root.current;
      const scope = element?.parentElement?.closest(SCOPE) ?? element?.firstElementChild;
      if (!scope) return;

      const start = () => {
        icon.current?.startAnimation();
      };
      const stop = () => {
        icon.current?.stopAnimation();
      };
      scope.addEventListener("mouseenter", start);
      scope.addEventListener("mouseleave", stop);
      return () => {
        scope.removeEventListener("mouseenter", start);
        scope.removeEventListener("mouseleave", stop);
      };
    }, []);

    // `display: contents` keeps the wrapper out of the layout.
    return createElement("span", { ref: root, className: "contents" }, createElement(Icon, { ref: icon, ...props }));
  }
  ScopedIcon.displayName = name;
  return ScopedIcon;
}
