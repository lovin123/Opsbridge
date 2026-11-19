"use client";

import * as React from "react";
import {
  Button as RadixButton,
  Callout,
  Text,
  TextField,
  type ButtonProps as RadixButtonProps,
} from "@radix-ui/themes";

type AppButtonVariant = "default" | "outline" | "ghost" | "danger";

const buttonVariantMap: Record<
  AppButtonVariant,
  Pick<RadixButtonProps, "variant" | "color" | "highContrast">
> = {
  default: { variant: "solid", highContrast: true },
  outline: { variant: "outline" },
  ghost: { variant: "ghost" },
  danger: { variant: "solid", color: "red" },
};

export type ButtonProps = Omit<RadixButtonProps, "variant" | "color"> & {
  variant?: AppButtonVariant;
  color?: RadixButtonProps["color"];
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", color, className, ...props },
  ref,
) {
  const mapped = buttonVariantMap[variant];
  return (
    <RadixButton
      ref={ref}
      className={className}
      variant={mapped.variant}
      color={color ?? mapped.color}
      highContrast={mapped.highContrast}
      {...props}
    />
  );
});

export type InputProps = React.ComponentPropsWithoutRef<typeof TextField.Root>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size = "3", style, ...props },
  ref,
) {
  return (
    <TextField.Root
      ref={ref}
      size={size}
      className={className}
      style={{ width: "100%", ...style }}
      {...props}
    />
  );
});

export function Label({
  children,
  htmlFor,
  className,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <Text as="label" htmlFor={htmlFor} size="2" weight="medium" className={className}>
      {children}
    </Text>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <Text size="2" color="red">
      {message}
    </Text>
  );
}

export function ErrorCallout({ children }: { children: React.ReactNode }) {
  return (
    <Callout.Root color="red" role="alert">
      <Callout.Text>{children}</Callout.Text>
    </Callout.Root>
  );
}

export function InfoCallout({ children }: { children: React.ReactNode }) {
  return (
    <Callout.Root color="blue">
      <Callout.Text>{children}</Callout.Text>
    </Callout.Root>
  );
}

export function SuccessCallout({ children }: { children: React.ReactNode }) {
  return (
    <Callout.Root color="teal">
      <Callout.Text>{children}</Callout.Text>
    </Callout.Root>
  );
}
