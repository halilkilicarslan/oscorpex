// Mobile nav toggle
(() => {
	const toggle = document.getElementById("navToggle");
	const menu = document.getElementById("navMobile");
	if (!toggle || !menu) return;

	toggle.addEventListener("click", () => {
		const open = menu.hasAttribute("hidden");
		if (open) {
			menu.removeAttribute("hidden");
		} else {
			menu.setAttribute("hidden", "");
		}
		toggle.setAttribute("aria-expanded", String(open));
	});

	// Close menu when a link is tapped
	menu.querySelectorAll("a").forEach((a) =>
		a.addEventListener("click", () => {
			menu.setAttribute("hidden", "");
			toggle.setAttribute("aria-expanded", "false");
		}),
	);
})();

// Contact form → sends via backend (/api/contact), falls back to a mailto draft
(() => {
	const form = document.getElementById("contactForm");
	const status = document.getElementById("formStatus");
	if (!form || !status) return;

	const EMAIL = "hello@oscorpex.com";
	const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const submitBtn = form.querySelector('button[type="submit"]');

	function setStatus(msg, kind) {
		status.textContent = msg;
		status.className = `form-status ${kind}`;
		status.hidden = false;
	}

	function mailtoFallback(name, email, company, message) {
		const subject = `New project inquiry — ${name}`;
		const body = `Full name: ${name}\nEmail: ${email}\n${company ? `Company: ${company}\n` : ""}\nProject:\n${message}\n`;
		window.location.href = `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
		setStatus("Opening a ready-to-send draft in your email app…", "ok");
	}

	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		const name = form.name.value.trim();
		const email = form.email.value.trim();
		const company = form.company.value.trim();
		const message = form.message.value.trim();

		[form.name, form.email, form.message].forEach((f) => f.classList.remove("invalid"));

		if (!name) { form.name.classList.add("invalid"); form.name.focus(); return setStatus("Please enter your name.", "err"); }
		if (!emailRe.test(email)) { form.email.classList.add("invalid"); form.email.focus(); return setStatus("Please enter a valid email address.", "err"); }
		if (!message) { form.message.classList.add("invalid"); form.message.focus(); return setStatus("Please tell us briefly about your project.", "err"); }

		if (submitBtn) { submitBtn.disabled = true; }
		setStatus("Sending…", "ok");

		try {
			const res = await fetch("https://api.oscorpex.com/contact", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, email, company, message }),
			});
			if (!res.ok) throw new Error("bad status " + res.status);
			setStatus("Thanks! Your message is on its way — we'll reply within 1 business day.", "ok");
			form.reset();
		} catch (err) {
			// Backend not available (e.g. local preview) → graceful mailto fallback
			mailtoFallback(name, email, company, message);
		} finally {
			if (submitBtn) { submitBtn.disabled = false; }
		}
	});
})();

// Scroll reveal for solution cards (visible by default; animates only with JS + motion allowed)
(() => {
	const els = document.querySelectorAll("[data-reveal]");
	if (!els.length || !("IntersectionObserver" in window)) return;
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

	document.body.classList.add("anim-ready");
	const io = new IntersectionObserver(
		(entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					entry.target.classList.add("is-in");
					io.unobserve(entry.target);
				}
			});
		},
		{ threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
	);

	els.forEach((el) => {
		const delay = Number(el.getAttribute("data-delay") || 0);
		el.style.transitionDelay = `${delay}ms`;
		io.observe(el);
	});
})();

// Count-up stats on scroll
(() => {
	const nums = document.querySelectorAll("[data-count]");
	if (!nums.length || !("IntersectionObserver" in window)) return;
	const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	const render = (el, value) => {
		const dec = Number(el.dataset.decimals || 0);
		el.textContent = value.toFixed(dec) + (el.dataset.suffix || "");
	};

	const io = new IntersectionObserver(
		(entries) => {
			entries.forEach((entry) => {
				if (!entry.isIntersecting) return;
				io.unobserve(entry.target);
				const el = entry.target;
				const target = Number.parseFloat(el.dataset.count);
				if (reduce) return render(el, target);
				const dur = 1100;
				const start = performance.now();
				const tick = (now) => {
					const p = Math.min(1, (now - start) / dur);
					render(el, target * (1 - (1 - p) ** 3));
					if (p < 1) requestAnimationFrame(tick);
					else render(el, target);
				};
				requestAnimationFrame(tick);
			});
		},
		{ threshold: 0.5 },
	);
	nums.forEach((n) => io.observe(n));
})();

// Live engine log — cycle the active step
(() => {
	const log = document.getElementById("engineLog");
	if (!log) return;
	const items = [...log.children];
	if (!items.length) return;

	const setActive = (idx) => {
		items.forEach((el, i) => el.classList.toggle("active", i === idx));
	};

	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		setActive(items.length - 1);
		return;
	}
	let i = 0;
	setActive(i);
	setInterval(() => {
		i = (i + 1) % items.length;
		setActive(i);
	}, 1500);
})();

// Hero agent-mesh background
(() => {
	const canvas = document.getElementById("heroMesh");
	if (!canvas) return;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	let w = 0;
	let h = 0;
	let nodes = [];
	let raf = 0;

	const resize = () => {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const rect = canvas.getBoundingClientRect();
		w = rect.width;
		h = rect.height;
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	};

	const seed = () => {
		const count = Math.max(18, Math.min(52, Math.round(w / 26)));
		nodes = Array.from({ length: count }, () => ({
			x: Math.random() * w,
			y: Math.random() * h,
			vx: (Math.random() - 0.5) * 0.18,
			vy: (Math.random() - 0.5) * 0.18,
		}));
	};

	const LINK = 128;
	const render = (move) => {
		ctx.clearRect(0, 0, w, h);
		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i];
			if (move) {
				a.x += a.vx;
				a.y += a.vy;
				if (a.x < 0 || a.x > w) a.vx *= -1;
				if (a.y < 0 || a.y > h) a.vy *= -1;
			}
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j];
				const dx = a.x - b.x;
				const dy = a.y - b.y;
				const d = Math.hypot(dx, dy);
				if (d < LINK) {
					ctx.strokeStyle = `rgba(34,197,94,${(1 - d / LINK) * 0.16})`;
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(a.x, a.y);
					ctx.lineTo(b.x, b.y);
					ctx.stroke();
				}
			}
		}
		for (const n of nodes) {
			ctx.fillStyle = "rgba(34,197,94,0.55)";
			ctx.beginPath();
			ctx.arc(n.x, n.y, 1.7, 0, Math.PI * 2);
			ctx.fill();
		}
	};

	const loop = () => {
		render(true);
		raf = requestAnimationFrame(loop);
	};

	resize();
	seed();
	if (reduce) {
		render(false);
	} else {
		loop();
	}

	let t;
	window.addEventListener("resize", () => {
		clearTimeout(t);
		t = setTimeout(() => {
			cancelAnimationFrame(raf);
			resize();
			seed();
			if (reduce) render(false);
			else loop();
		}, 180);
	});
})();
