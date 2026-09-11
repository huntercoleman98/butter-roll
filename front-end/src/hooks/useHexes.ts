  import { HexGrid_Orientation } from "../gen/butterroll/v1/game_pb";
import type { HexGridConfig } from "./useGameSocket";

  export interface HexCoord {
    q: number;
    r: number;
  }
  
  /**
   * Returns the center of an axial hex.
   *
   * offsetX / offsetY are the center of hex (0, 0).
   * width / height are the full bounding-box dimensions of a hex.
   */
  export function hexCenter(
    hex: HexCoord,
    grid: HexGridConfig,
  ): { x: number; y: number } {
    const { q, r } = hex;
  
    if (grid.orientation === HexGrid_Orientation.POINTY) {
      // Pointy-top axial layout.
      //
      // Horizontal distance between columns:
      //   sqrt(3) / 2 * height
      //
      // Vertical distance between rows:
      //   3 / 4 * height
      const horizontalSpacing = (Math.sqrt(3) / 2) * grid.height;
      const verticalSpacing = (3 / 4) * grid.height;
  
      return {
        x: grid.offsetX + horizontalSpacing * (q + r / 2),
        y: grid.offsetY + verticalSpacing * r,
      };
    }
  
    // Flat-top axial layout.
    //
    // Horizontal distance between columns:
    //   3 / 4 * width
    //
    // Vertical distance between rows:
    //   sqrt(3) / 2 * width
    const horizontalSpacing = (3 / 4) * grid.width;
    const verticalSpacing = (Math.sqrt(3) / 2) * grid.width;
  
    return {
      x: grid.offsetX + horizontalSpacing * q,
      y: grid.offsetY + verticalSpacing * (r + q / 2),
    };
  }
  
  /**
   * Return the six vertices of a hex as a Konva-compatible
   * [x1, y1, x2, y2, ...] array.
   */
  export function hexPolygon(
    hex: HexCoord,
    grid: HexGridConfig,
  ): number[] {
    const center = hexCenter(hex, grid);
  
    const points: number[] = [];
  
    // Flat-top hexes have a vertex at 0 degrees.
    // Pointy-top hexes have a vertex at -90 degrees.
    const startAngle =
      grid.orientation === HexGrid_Orientation.POINTY
        ? -Math.PI / 2
        : 0;
  
    // The circumradius depends on orientation.
    //
    // Pointy:
    //   width = sqrt(3) * radius
    //   height = 2 * radius
    //
    // Flat:
    //   width = 2 * radius
    //   height = sqrt(3) * radius
    const radius =
      grid.orientation === HexGrid_Orientation.POINTY
        ? grid.height / 2
        : grid.width / 2;
  
    for (let i = 0; i < 6; i++) {
      const angle = startAngle + (Math.PI / 3) * i;
  
      points.push(
        center.x + radius * Math.cos(angle),
        center.y + radius * Math.sin(angle),
      );
    }
  
    return points;
  }
  
  /**
   * Convert world coordinates into the nearest axial hex.
   */
  export function worldToHex(
    x: number,
    y: number,
    grid: HexGridConfig,
  ): HexCoord {
    const localX = x - grid.offsetX;
    const localY = y - grid.offsetY;
  
    let q: number;
    let r: number;
  
    if (grid.orientation === HexGrid_Orientation.POINTY) {
      const size = grid.height / 2;
  
      q =
        ((Math.sqrt(3) / 3) * localX -
          (1 / 3) * localY) /
        size;
  
      r =
        ((2 / 3) * localY) /
        size;
    } else {
      const size = grid.width / 2;
  
      q =
        ((2 / 3) * localX) /
        size;
  
      r =
        ((-1 / 3) * localX +
          (Math.sqrt(3) / 3) * localY) /
        size;
    }
  
    return axialRound(q, r);
  }
  
  function axialRound(q: number, r: number): HexCoord {
    const x = q;
    const z = r;
    const y = -x - z;
  
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
  
    const xDiff = Math.abs(rx - x);
    const yDiff = Math.abs(ry - y);
    const zDiff = Math.abs(rz - z);
  
    if (xDiff > yDiff && xDiff > zDiff) {
      rx = -ry - rz;
    } else if (yDiff > zDiff) {
      ry = -rx - rz;
    } else {
      rz = -rx - ry;
    }
  
    return {
      q: rx,
      r: rz,
    };
  }