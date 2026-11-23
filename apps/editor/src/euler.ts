const RAD = Math.PI / 180

/** Euler angles in degrees, applied about x, then y, then z around the fixed axes. */
export function quatToEuler(qx: number, qy: number, qz: number, qw: number): [number, number, number] {
	const x = Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy))
	const sinY = 2 * (qw * qy - qz * qx)
	const y = Math.abs(sinY) >= 1 ? Math.sign(sinY) * (Math.PI / 2) : Math.asin(sinY)
	const z = Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz))
	return [x / RAD, y / RAD, z / RAD]
}

export function eulerToQuat(xDegrees: number, yDegrees: number, zDegrees: number): [number, number, number, number] {
	const cr = Math.cos((xDegrees * RAD) / 2)
	const sr = Math.sin((xDegrees * RAD) / 2)
	const cp = Math.cos((yDegrees * RAD) / 2)
	const sp = Math.sin((yDegrees * RAD) / 2)
	const cy = Math.cos((zDegrees * RAD) / 2)
	const sy = Math.sin((zDegrees * RAD) / 2)
	return [sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy]
}
