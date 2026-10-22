import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

// Heights are 44px on a phone (touch targets) and compact from `sm` up.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-transparent text-sm font-medium transition-colors duration-150 outline-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background shadow-sm hover:bg-foreground/90",
        secondary: "border-border bg-muted text-foreground hover:border-border-strong hover:bg-elevated",
        outline: "border-border bg-transparent text-foreground hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive: "border-danger/20 bg-danger/10 text-danger hover:bg-danger/20",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-4 sm:h-9",
        xs: "h-11 gap-1 rounded-md px-2.5 text-xs sm:h-7 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-11 gap-1.5 rounded-md px-3 sm:h-8 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 px-5 sm:h-10",
        icon: "size-11 sm:size-9",
        "icon-xs": "size-11 rounded-md sm:size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-11 rounded-md sm:size-8",
        "icon-lg": "size-11 sm:size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child (e.g. a Link) with the button's styling instead of a <button>. */
    asChild?: boolean;
  };

function Button({ className, variant = "default", size = "default", asChild = false, children, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot data-slot="button" className={classes} {...(props as React.HTMLAttributes<HTMLElement>)}>
        {children as React.ReactNode}
      </Slot>
    );
  }
  return (
    <ButtonPrimitive data-slot="button" className={classes} {...props}>
      {children}
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
