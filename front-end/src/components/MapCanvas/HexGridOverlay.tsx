import { Line } from "react-konva";
import type { HexGridConfig } from "../../hooks/useGameSocket";
import { useState } from "react";
import { hexCenter, hexPolygon, type HexCoord } from "../../hooks/useHexes";

interface HexGeneratorInputProps {
    label: string
    value: number
    onChange: (n: number) => void;
}

function evaluate(raw: string): number | null {
    const expr = raw.trim();
    const opMatch = expr.match(/^([\d.]+)\s*([+\-*/])?\s*([\d.]+)$/);
    if (opMatch) {
        const current = parseFloat(opMatch[1]);
        const operand = parseFloat(opMatch[3]);
        switch (opMatch[2]) {
            case "+":
                return Math.round(current + operand);
            case "-":
                return Math.round(current - operand);
            case "*":
                return Math.round(current * operand);
            case "/":
                return operand !== 0 ? Math.round(current / operand) : null;
        }
    }
    const n = parseFloat(expr);
    return isNaN(n) ? null : Math.round(n);
}

export function HexGeneratorInput({ label, value, onChange }: HexGeneratorInputProps) {
    const [display, setDisplay] = useState(String(value));

    // Sync display when value changes externally (e.g. aspect-ratio lock updates the other axis)
    const [prevValue, setPrevValue] = useState(value);
    if (value !== prevValue) {
        setPrevValue(value);
        setDisplay(String(value));
    }

    function commit(raw: string) {
        const result = evaluate(raw);
        if (result !== null && result >= 0) {
            onChange(result);
            setDisplay(String(result));
        } else {
            setDisplay(String(value));
        }
    }
    return (
        <div className="field-row">
            <label>{label}</label>
            <input
                type="text"
                value={display}
                style={{ width: 72 }}
                onChange={(e) => setDisplay(e.target.value)}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.currentTarget.blur();
                    }
                }}
            />
        </div>)
}

interface HexGridOverlayProps {
    hexGrid: HexGridConfig;
    mapWidth: number;
    mapHeight: number;
  }

export default function HexGridOverlay({
    hexGrid,
    mapWidth,
    mapHeight,
  }: HexGridOverlayProps) {
    const hexes: HexCoord[] = [];
  
    // Generate a generous range of axial coordinates.
    for (let q = -100; q <= 100; q++) {
      for (let r = -100; r <= 100; r++) {
        const center = hexCenter({ q, r }, hexGrid);
  
        // Skip hexes whose centers are nowhere near the map.
        if (
          center.x < -hexGrid.width ||
          center.x > mapWidth + hexGrid.width ||
          center.y < -hexGrid.height ||
          center.y > mapHeight + hexGrid.height
        ) {
          continue;
        }
  
        hexes.push({ q, r });
      }
    }
  
    return (
      <>
        {hexes.map((hex) => (
          <Line
            key={`${hex.q},${hex.r}`}
            points={hexPolygon(hex, hexGrid)}
            closed
            stroke="red"
            strokeWidth={2}
            listening={false}
          />
        ))}
      </>
    );
  }