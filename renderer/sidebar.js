console.log('[SIDEBAR-SCRIPT] Script loading in iframe...');

const statusElement = document.getElementById('securityStatus');
const trustScoreElement = document.getElementById('trustScore');
const trustDeltaElement = document.getElementById('trustDelta');
const trustProgressElement = document.getElementById('trustProgress');
const trustBadgeElement = document.getElementById('trustBadge');
const analysisFeedElement = document.getElementById('analysisFeed');
const feedCountElement = document.getElementById('feedCount');

console.log('[SIDEBAR-SCRIPT] Elements found:', {
  statusElement: !!statusElement,
  trustScoreElement: !!trustScoreElement,
  trustDeltaElement: !!trustDeltaElement,
  trustProgressElement: !!trustProgressElement,
  trustBadgeElement: !!trustBadgeElement,
  analysisFeedElement: !!analysisFeedElement,
  feedCountElement: !!feedCountElement
});

let eventCount = 0;

function toPercentage(probability) {
	const safe = Number.isFinite(probability) ? probability : 0;
	return `${(Math.max(0, Math.min(1, safe)) * 100).toFixed(1)}%`;
}

function toRiskClass(riskLevel) {
	const normalized = (riskLevel || '').toUpperCase();
	if (normalized === 'HIGH') {
		return 'badge badge-high';
	}
	if (normalized === 'MEDIUM') {
		return 'badge badge-medium';
	}
	return 'badge badge-low';
}

function toRiskCardClass(riskLevel) {
	const normalized = (riskLevel || '').toUpperCase();
	if (normalized === 'HIGH') {
		return 'risk-high';
	}
	if (normalized === 'MEDIUM') {
		return 'risk-medium';
	}
	return 'risk-low';
}

function trustLabel(score) {
	if (!Number.isFinite(score)) {
		return 'UNKNOWN';
	}
	if (score >= 80) {
		return 'STABLE';
	}
	if (score >= 50) {
		return 'WATCH';
	}
	return 'ELEVATED';
}

function createThumbnail(imageUrl) {
	if (!imageUrl || typeof imageUrl !== 'string') {
		const fallback = document.createElement('div');
		fallback.className = 'thumb';
		return fallback;
	}

	const image = document.createElement('img');
	image.className = 'thumb';
	image.loading = 'lazy';
	image.referrerPolicy = 'no-referrer';
	image.src = imageUrl;
	image.alt = 'Detected image thumbnail';
	image.addEventListener('error', () => {
		image.removeAttribute('src');
		image.alt = 'Thumbnail unavailable';
	});
	return image;
}

function renderEventCard(analysis) {
	const card = document.createElement('div');
	card.className = `event-card ${toRiskCardClass(analysis.risk_level)}`;

	const top = document.createElement('div');
	top.className = 'event-top';
	card.appendChild(top);

	top.appendChild(createThumbnail(analysis.image_url));

	const meta = document.createElement('div');
	meta.className = 'meta';
	top.appendChild(meta);

	const fakeProbability = Number(analysis.fake_probability);
	const riskBadge = document.createElement('span');
	riskBadge.className = toRiskClass(analysis.risk_level);
	riskBadge.textContent = `${(analysis.risk_level || 'LOW').toUpperCase()}`;
	meta.appendChild(riskBadge);

	const probabilityRow = document.createElement('div');
	probabilityRow.textContent = `Fake: ${toPercentage(fakeProbability)}`;
	probabilityRow.style.fontSize = '11px';
	meta.appendChild(probabilityRow);

	const details = document.createElement('details');
	details.className = 'forensic-details';

	const summary = document.createElement('summary');
	summary.textContent = 'Details';
	details.appendChild(summary);

	const list = document.createElement('ul');
	list.className = 'explanations';
	const explanationItems = Array.isArray(analysis.forensic_explanation)
		? analysis.forensic_explanation.slice(0, 3)
		: ['No forensic explanation provided.'];

	for (const line of explanationItems) {
		const li = document.createElement('li');
		li.textContent = line.length > 80 ? line.substring(0, 77) + '...' : line;
		list.appendChild(li);
	}

	details.appendChild(list);
	card.appendChild(details);
	return card;
}

function updateSummary(analysis) {
	if (trustScoreElement) {
		const score = Number(analysis.trust_score);
		const scoreText = Number.isFinite(score) ? score.toFixed(2) : 'N/A';
		
		// Animate score change
		if (trustScoreElement.textContent !== scoreText) {
			trustScoreElement.classList.remove('animate');
			void trustScoreElement.offsetWidth; // Trigger reflow
			trustScoreElement.classList.add('animate');
		}
		
		trustScoreElement.textContent = scoreText;

		if (trustProgressElement) {
			const bounded = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
			trustProgressElement.style.width = `${bounded}%`;
		}

		if (trustBadgeElement) {
			trustBadgeElement.textContent = trustLabel(score);
		}
	}

	if (trustDeltaElement) {
		const delta = Number(analysis.trust_score_delta);
		const deltaText = Number.isFinite(delta) ? `Latest: ${delta.toFixed(2)}` : 'Latest unavailable';
		trustDeltaElement.textContent = deltaText;
	}

	if (statusElement) {
		const now = new Date();
		const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
		statusElement.textContent = `Last scan: ${time} - ${(analysis.risk_level || 'LOW').toUpperCase()}`;
	}
}

window.addEventListener('message', (event) => {
	console.log('[SIDEBAR] Received message event');
	if (!event.data || event.data.type !== 'image-analysis' || !event.data.payload) {
		console.log('[SIDEBAR] Skipping non-analysis message');
		return;
	}

	const analysis = event.data.payload;
	console.log('[SIDEBAR] Processing analysis:', { risk: analysis.risk_level, fake: analysis.fake_probability });
	updateSummary(analysis);

	if (!analysisFeedElement) {
		console.error('[SIDEBAR] analysisFeedElement not found');
		return;
	}

	// Clear empty state on first event
	const emptyState = analysisFeedElement.querySelector('.empty-state');
	if (emptyState) {
		console.log('[SIDEBAR] Removing empty state');
		emptyState.remove();
	}

	const card = renderEventCard(analysis);
	analysisFeedElement.prepend(card);
	eventCount++;
	
	if (feedCountElement) {
		feedCountElement.textContent = `${eventCount} event${eventCount === 1 ? '' : 's'}`;
	}

	console.log('[SIDEBAR] Event card rendered, total events:', eventCount);

	// Keep only last 50 events
	while (analysisFeedElement.children.length > 50) {
		analysisFeedElement.removeChild(analysisFeedElement.lastElementChild);
	}
});

console.log('[SIDEBAR-SCRIPT] Message listener registered successfully');
