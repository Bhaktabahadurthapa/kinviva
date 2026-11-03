import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {c, f} from './theme';

const grain =
	"url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/** Warm ink backdrop with a vermilion glow and film grain. */
export const Stage: React.FC<{children: React.ReactNode; glow?: [number, number]}> = ({children, glow = [20, 15]}) => (
	<AbsoluteFill
		style={{
			background: `radial-gradient(1200px 700px at ${glow[0]}% ${glow[1]}%, rgba(255,95,46,0.16), transparent 60%), linear-gradient(180deg, ${c.bg2}, ${c.bg})`,
			color: c.text,
			fontFamily: f.ui,
		}}
	>
		{children}
		<AbsoluteFill style={{backgroundImage: grain, opacity: 0.07, pointerEvents: 'none'}} />
	</AbsoluteFill>
);

/** Spring-in progress 0..1 starting at `delay` frames. */
export const useIn = (delay = 0, damping = 200) => {
	const frame = useCurrentFrame();
	const {fps} = useVideoConfig();
	return spring({frame: frame - delay, fps, config: {damping}});
};

export const Label: React.FC<{children: React.ReactNode; color?: string; style?: React.CSSProperties}> = ({children, color = c.text3, style}) => (
	<div
		style={{
			fontFamily: f.mono,
			fontSize: 20,
			fontWeight: 500,
			letterSpacing: '0.16em',
			textTransform: 'uppercase',
			color,
			...style,
		}}
	>
		{children}
	</div>
);

export type Rect = {x: number; y: number; w: number; h: number};

/**
 * A macOS-style window showing a real screenshot, with a camera that eases
 * from one rectangle of the image (in image pixels) to another.
 */
export const AppShot: React.FC<{
	src: string;
	img: {w: number; h: number};
	view: {w: number; h: number};
	from: Rect;
	to: Rect;
	moveStart?: number;
	moveFrames?: number;
	highlight?: Rect;
	style?: React.CSSProperties;
}> = ({src, img, view, from, to, moveStart = 20, moveFrames = 45, highlight, style}) => {
	const frame = useCurrentFrame();
	const t = interpolate(frame, [moveStart, moveStart + moveFrames], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		easing: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
	});
	const lerp = (a: number, b: number) => a + (b - a) * t;
	const r = {x: lerp(from.x, to.x), y: lerp(from.y, to.y), w: lerp(from.w, to.w), h: lerp(from.h, to.h)};
	const k = Math.min(view.w / r.w, view.h / r.h);
	const tx = view.w / 2 - (r.x + r.w / 2) * k;
	const ty = view.h / 2 - (r.y + r.h / 2) * k;
	const hl = highlight
		? interpolate(frame, [moveStart + moveFrames - 6, moveStart + moveFrames + 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
		: 0;
	return (
		<div
			style={{
				width: view.w,
				height: view.h,
				borderRadius: 18,
				overflow: 'hidden',
				position: 'relative',
				border: `1px solid ${c.lineStrong}`,
				boxShadow: '0 40px 90px -30px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.04)',
				background: c.bg,
				...style,
			}}
		>
			<div style={{position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${k})`}}>
				<Img src={staticFile(src)} style={{width: img.w, height: img.h, display: 'block'}} />
				{highlight && (
					<div
						style={{
							position: 'absolute',
							left: highlight.x,
							top: highlight.y,
							width: highlight.w,
							height: highlight.h,
							borderRadius: 22,
							border: `${4 / k}px solid ${c.signal}`,
							boxShadow: `0 0 ${40 / k}px rgba(255,95,46,0.55)`,
							opacity: hl,
						}}
					/>
				)}
			</div>
		</div>
	);
};

/** Caption card used over screenshots. */
export const Callout: React.FC<{kicker: string; title: React.ReactNode; body?: string; delay?: number; style?: React.CSSProperties}> = ({
	kicker,
	title,
	body,
	delay = 30,
	style,
}) => {
	const p = useIn(delay);
	return (
		<div
			style={{
				position: 'absolute',
				opacity: p,
				transform: `translateY(${(1 - p) * 24}px)`,
				background: 'rgba(21,18,15,0.92)',
				border: `1px solid ${c.lineStrong}`,
				borderLeft: `4px solid ${c.signal}`,
				borderRadius: 16,
				padding: '22px 28px 24px',
				maxWidth: 620,
				boxShadow: '0 30px 60px -20px rgba(0,0,0,0.8)',
				...style,
			}}
		>
			<Label color={c.signal}>{kicker}</Label>
			<div style={{fontFamily: f.display, fontSize: 46, fontWeight: 500, lineHeight: 1.1, marginTop: 10, letterSpacing: '-0.01em'}}>{title}</div>
			{body && <div style={{fontSize: 24, color: c.text2, marginTop: 12, lineHeight: 1.4}}>{body}</div>}
		</div>
	);
};

export const Logo: React.FC<{size?: number}> = ({size = 64}) => (
	<svg width={size} height={size} viewBox="0 0 24 24">
		<circle cx="12" cy="12" r="10.5" fill="none" stroke={c.lineStrong} strokeWidth="1.2" />
		<circle cx="12" cy="12" r="6.8" fill="none" stroke={c.text} strokeWidth="1.6" />
		<circle cx="12" cy="12" r="3" fill={c.signal} />
	</svg>
);
