import { motion, useAnimation } from "motion/react";
import { forwardRef, useImperativeHandle } from "react";

import { cn } from "@/lib/cn";

import type { IconHandle, IconProps } from "./types";

/**
 * Icons that lucide-animated does not draw: the shapes are lucide's, the movement
 * is one of a few small presets (`pop`, `wiggle`, `shake`, `press`, `stretch`, `pulse`).
 * They are driven from outside (see `scope.ts`), like the others.
 */

export const TrophyAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { scale: 1, y: 0 }, animate: { scale: 1.12, y: -1.5 } }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2" />
          <path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2" />
          <path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3" />
          <path d="M4 22h16" />
          <path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" />
          <path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3" />
        </motion.svg>
      </div>
    );
  },
);
TrophyAnimated.displayName = "TrophyAnimated";

export const Gamepad2Animated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -12, 12, -6, 0] } }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="6" x2="10" y1="11" y2="11" />
          <line x1="8" x2="8" y1="9" y2="13" />
          <line x1="15" x2="15.01" y1="12" y2="12" />
          <line x1="18" x2="18.01" y1="10" y2="10" />
          <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
        </motion.svg>
      </div>
    );
  },
);
Gamepad2Animated.displayName = "Gamepad2Animated";

export const TriangleAlertAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -9, 9, -5, 0] } }}
          transition={{ duration: 0.45, ease: "easeInOut" }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </motion.svg>
      </div>
    );
  },
);
TriangleAlertAnimated.displayName = "TriangleAlertAnimated";

export const CircleAlertAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -9, 9, -5, 0] } }}
          transition={{ duration: 0.45, ease: "easeInOut" }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" x2="12" y1="8" y2="12" />
          <line x1="12" x2="12.01" y1="16" y2="16" />
        </motion.svg>
      </div>
    );
  },
);
CircleAlertAnimated.displayName = "CircleAlertAnimated";

export const ShieldAlertAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -9, 9, -5, 0] } }}
          transition={{ duration: 0.45, ease: "easeInOut" }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </motion.svg>
      </div>
    );
  },
);
ShieldAlertAnimated.displayName = "ShieldAlertAnimated";

export const Trash2Animated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -9, 9, -5, 0] } }}
          transition={{ duration: 0.45, ease: "easeInOut" }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </motion.svg>
      </div>
    );
  },
);
Trash2Animated.displayName = "Trash2Animated";

export const SquareAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { scale: 1 }, animate: { scale: 0.82 } }}
          transition={{ type: "spring", duration: 0.25, bounce: 0 }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="18" height="18" x="3" y="3" rx="2" />
        </motion.svg>
      </div>
    );
  },
);
SquareAnimated.displayName = "SquareAnimated";

export const SearchXAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -12, 12, -6, 0] } }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m13.5 8.5-5 5" />
          <path d="m8.5 8.5 5 5" />
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </motion.svg>
      </div>
    );
  },
);
SearchXAnimated.displayName = "SearchXAnimated";

export const MinusAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { scaleX: 1 }, animate: { scaleX: 1.3 } }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14" />
        </motion.svg>
      </div>
    );
  },
);
MinusAnimated.displayName = "MinusAnimated";

export const CircleAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { scale: 1 }, animate: { scale: [1, 1.22, 1] } }}
          transition={{ duration: 0.45, ease: "easeInOut" }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
        </motion.svg>
      </div>
    );
  },
);
CircleAnimated.displayName = "CircleAnimated";

export const KeyRoundAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -12, 12, -6, 0] } }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
          <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
        </motion.svg>
      </div>
    );
  },
);
KeyRoundAnimated.displayName = "KeyRoundAnimated";

export const ScrollTextAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { scale: 1, y: 0 }, animate: { scale: 1.12, y: -1.5 } }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 12h-5" />
          <path d="M15 8h-5" />
          <path d="M19 17V5a2 2 0 0 0-2-2H4" />
          <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
        </motion.svg>
      </div>
    );
  },
);
ScrollTextAnimated.displayName = "ScrollTextAnimated";

export const UserRoundAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { scale: 1, y: 0 }, animate: { scale: 1.12, y: -1.5 } }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="8" r="5" />
          <path d="M20 21a8 8 0 0 0-16 0" />
        </motion.svg>
      </div>
    );
  },
);
UserRoundAnimated.displayName = "UserRoundAnimated";

export const ScanSearchAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -12, 12, -6, 0] } }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 7V5a2 2 0 0 1 2-2h2" />
          <path d="M17 3h2a2 2 0 0 1 2 2v2" />
          <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
          <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
          <circle cx="12" cy="12" r="3" />
          <path d="m16 16-1.9-1.9" />
        </motion.svg>
      </div>
    );
  },
);
ScanSearchAnimated.displayName = "ScanSearchAnimated";

export const InfoAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { scale: 1 }, animate: { scale: [1, 1.22, 1] } }}
          transition={{ duration: 0.45, ease: "easeInOut" }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </motion.svg>
      </div>
    );
  },
);
InfoAnimated.displayName = "InfoAnimated";

export const FolderSearchAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -12, 12, -6, 0] } }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1" />
          <path d="m21 21-1.9-1.9" />
          <circle cx="17" cy="17" r="3" />
        </motion.svg>
      </div>
    );
  },
);
FolderSearchAnimated.displayName = "FolderSearchAnimated";

export const ClipboardPasteAnimated = forwardRef<IconHandle, IconProps>(
  ({ size = 16, className, ...props }, ref) => {
    const controls = useAnimation();

    useImperativeHandle(ref, () => ({
      startAnimation: () => {
        void controls.start("animate");
      },
      stopAnimation: () => {
        void controls.start("normal");
      },
    }));

    return (
      <div className={cn("animated-icon inline-flex shrink-0", className)} {...props}>
        <motion.svg
          animate={controls}
          variants={{ normal: { scale: 1, y: 0 }, animate: { scale: 1.12, y: -1.5 } }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 14h10" />
          <path d="M16 4h2a2 2 0 0 1 2 2v1.344" />
          <path d="m17 18 4-4-4-4" />
          <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113" />
          <rect x="8" y="2" width="8" height="4" rx="1" />
        </motion.svg>
      </div>
    );
  },
);
ClipboardPasteAnimated.displayName = "ClipboardPasteAnimated";
