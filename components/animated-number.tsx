"use client";

import { useState } from "react";

export function AnimatedNumber({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [prev, setPrev] = useState(value);
  const [animating, setAnimating] = useState(false);

  if (value !== prev) {
    setPrev(value);
    setAnimating(true);
  }

  return (
    <div
      className={`${className ?? ""} ${animating ? "animate-number-roll" : ""}`}
      onAnimationEnd={() => setAnimating(false)}
    >
      {value}
    </div>
  );
}
