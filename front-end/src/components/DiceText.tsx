import React from "react";

interface Props {
  text: string;
  /** Roll label, e.g. "Aboleth — Curse". */
  label?: string;
  onRoll: (expression: string, label?: string) => void;
}

const DICE_RE = /\[(\d*d\d+(?:[+-]\d+)?)\]/gi;

/** Renders text with [NdN] dice notation replaced by roll buttons. */
export default function DiceText({ text, label, onRoll }: Props) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(DICE_RE)) {
    const index = match.index;
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    const notation = match[1];
    parts.push(
      <button
        key={index}
        className="dice-text-btn"
        onClick={() => onRoll(notation, label)}
      >
        {notation}
      </button>,
    );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <span>{parts}</span>;
}
