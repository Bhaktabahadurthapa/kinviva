import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {f} from './theme';

/** Persistent BKT AI channel watermark (bottom-right). */
export const Branding: React.FC = () => {
	const frame = useCurrentFrame();
	const {durationInFrames} = useVideoConfig();
	const opacity = interpolate(frame, [0, 20, durationInFrames - 20, durationInFrames], [0, 0.85, 0.85, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	return (
		<div
			style={{
				position: 'absolute',
				right: 40,
				bottom: 36,
				opacity,
				display: 'flex',
				alignItems: 'center',
				gap: 10,
				padding: '8px 16px 8px 9px',
				borderRadius: 999,
				background: 'rgba(17,15,13,0.72)',
				border: '1px solid rgba(255,255,255,0.12)',
				backdropFilter: 'blur(6px)',
				fontFamily: f.ui,
				fontWeight: 650,
				fontSize: 20,
				letterSpacing: '0.04em',
				color: '#fff',
				zIndex: 100,
			}}
		>
			<div
				style={{
					width: 26,
					height: 26,
					borderRadius: '50%',
					background: 'linear-gradient(135deg, #2f7bff 0%, #1fd18b 100%)',
					boxShadow: '0 0 12px rgba(31,209,139,0.45)',
				}}
			/>
			BKT AI
		</div>
	);
};
