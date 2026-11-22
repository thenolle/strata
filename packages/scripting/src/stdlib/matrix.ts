import type { Point } from './geometry.ts'

/** A 2D affine transform: x' = a x + c y + e, y' = b x + d y + f. Immutable. */
export class Matrix2D {
	static readonly identity = new Matrix2D(1, 0, 0, 1, 0, 0)

	constructor(readonly a: number, readonly b: number, readonly c: number, readonly d: number, readonly e: number, readonly f: number) {}

	static translate(x: number, y: number): Matrix2D {
		return new Matrix2D(1, 0, 0, 1, x, y)
	}
	static rotate(radians: number): Matrix2D {
		const cos = Math.cos(radians)
		const sin = Math.sin(radians)
		return new Matrix2D(cos, sin, -sin, cos, 0, 0)
	}
	static scale(sx: number, sy = sx): Matrix2D {
		return new Matrix2D(sx, 0, 0, sy, 0, 0)
	}
	/** Scale first, then rotate, then move. */
	static compose(x: number, y: number, rotation = 0, sx = 1, sy = sx): Matrix2D {
		return Matrix2D.translate(x, y).multiply(Matrix2D.rotate(rotation)).multiply(Matrix2D.scale(sx, sy))
	}

	/** The transform that applies other first, then this one. */
	multiply(o: Matrix2D): Matrix2D {
		return new Matrix2D(this.a * o.a + this.c * o.b, this.b * o.a + this.d * o.b, this.a * o.c + this.c * o.d, this.b * o.c + this.d * o.d, this.a * o.e + this.c * o.f + this.e, this.b * o.e + this.d * o.f + this.f)
	}
	apply(p: Point): Point {
		return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f }
	}
	invert(): Matrix2D | undefined {
		const det = this.a * this.d - this.b * this.c
		if (Math.abs(det) < 1e-12) return undefined
		return new Matrix2D(this.d / det, -this.b / det, -this.c / det, this.a / det, (this.c * this.f - this.d * this.e) / det, (this.b * this.e - this.a * this.f) / det)
	}
}
