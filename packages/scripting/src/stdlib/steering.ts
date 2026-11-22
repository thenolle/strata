import { Vec2 } from './vec.ts'

/** Steering behaviors return a force: add it to velocity, scaled by dt. */
export const seek = (position: Vec2, velocity: Vec2, target: Vec2, maxSpeed: number, maxForce: number): Vec2 => target.sub(position).normalized().mul(maxSpeed).sub(velocity).limit(maxForce)
export const flee = (position: Vec2, velocity: Vec2, threat: Vec2, maxSpeed: number, maxForce: number): Vec2 => position.sub(threat).normalized().mul(maxSpeed).sub(velocity).limit(maxForce)

/** Like seek, but slows down inside slowRadius so the mover stops at the target. */
export function arrive(position: Vec2, velocity: Vec2, target: Vec2, maxSpeed: number, maxForce: number, slowRadius: number): Vec2 {
	const offset = target.sub(position)
	const distance = offset.len()
	if (distance === 0) return velocity.negate().limit(maxForce)
	const speed = distance < slowRadius ? maxSpeed * (distance / slowRadius) : maxSpeed
	return offset.mul(speed / distance).sub(velocity).limit(maxForce)
}

/** Seeks where a moving target is about to be. */
export function pursue(position: Vec2, velocity: Vec2, target: Vec2, targetVelocity: Vec2, maxSpeed: number, maxForce: number): Vec2 {
	const lookAhead = maxSpeed === 0 ? 0 : target.dist(position) / maxSpeed
	return seek(position, velocity, target.add(targetVelocity.mul(lookAhead)), maxSpeed, maxForce)
}

/** Pushes away from neighbors closer than radius, harder the closer they are. */
export function separation(position: Vec2, neighbors: readonly Vec2[], radius: number): Vec2 {
	let force = Vec2.zero
	for (const other of neighbors) {
		const distance = position.dist(other)
		if (distance > 0 && distance < radius) force = force.add(position.sub(other).normalized().div(distance))
	}
	return force
}
export function cohesion(position: Vec2, neighbors: readonly Vec2[]): Vec2 {
	if (neighbors.length === 0) return Vec2.zero
	return neighbors.reduce((sum, other) => sum.add(other), Vec2.zero).div(neighbors.length).sub(position)
}
export function alignment(velocities: readonly Vec2[]): Vec2 {
	return velocities.length === 0 ? Vec2.zero : velocities.reduce((sum, v) => sum.add(v), Vec2.zero).div(velocities.length)
}

/**
 * Where to aim a projectile of constant speed to hit a moving target, or undefined when it cannot catch up.
 */
export function predictIntercept(shooter: Vec2, projectileSpeed: number, target: Vec2, targetVelocity: Vec2): Vec2 | undefined {
	const offset = target.sub(shooter)
	const a = targetVelocity.dot(targetVelocity) - projectileSpeed * projectileSpeed
	const b = 2 * offset.dot(targetVelocity)
	const c = offset.dot(offset)
	let time: number | undefined
	if (Math.abs(a) < 1e-9) time = b === 0 ? undefined : -c / b
	else {
		const discriminant = b * b - 4 * a * c
		if (discriminant < 0) return undefined
		const root = Math.sqrt(discriminant)
		const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((value) => value > 0)
		time = candidates.length === 0 ? undefined : Math.min(...candidates)
	}
	return time === undefined || time < 0 ? undefined : target.add(targetVelocity.mul(time))
}

/** The low launch angle in radians that lands a projectile at a distance on level ground, or undefined when out of range. */
export function launchAngle(distance: number, speed: number, gravity: number): number | undefined {
	const value = (gravity * distance) / (speed * speed)
	return Math.abs(value) > 1 ? undefined : 0.5 * Math.asin(value)
}
