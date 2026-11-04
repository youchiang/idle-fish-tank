/**
 * Fish Species & Procedural / Image Rendering System
 * Supports:
 * 1. 6 distinct procedural vector fish species
 * 2. Custom local/web image support (PNG, GIF, WebP, SVG, Data URL)
 * 3. Physics, wandering AI, food chasing, hunger decay, and idle coin generation
 */

// Image Cache Manager for custom fish images (supports local files, data URLs, and remote web URLs)
const FishImageCache = {
    cache: new Map(),
    getImage(src) {
        if (!src) return null;
        if (this.cache.has(src)) {
            return this.cache.get(src);
        }
        const img = new Image();
        // Do NOT set crossOrigin='anonymous' because canvas is not read via toDataURL and external CDNs without CORS would fail
        img.loaded = false;
        img.error = false;
        img.onload = () => { img.loaded = true; };
        img.onerror = () => {
            img.error = true;
            console.warn('Failed to load custom fish image from URL:', src);
        };
        img.src = src;
        this.cache.set(src, img);
        return img;
    }
};

const FISH_SPECIES = {
    clownfish: {
        id: 'clownfish',
        name: '小丑魚',
        nickname: '尼莫',
        price: 50,
        baseIncome: 1,
        incomeInterval: 8000,
        speed: 1.4,
        scale: 1.0,
        description: '好奇又活潑的珊瑚礁明星，隨時都在快樂擺尾。'
    },
    bluetang: {
        id: 'bluetang',
        name: '藍倒吊',
        nickname: '多莉',
        price: 150,
        baseIncome: 3,
        incomeInterval: 8000,
        speed: 1.7,
        scale: 1.05,
        description: '亮麗的皇家藍搭配檸檬黃尾巴，游泳速度極快。'
    },
    goldfish: {
        id: 'goldfish',
        name: '櫻花金魚',
        nickname: '泡泡',
        price: 380,
        baseIncome: 8,
        incomeInterval: 8000,
        speed: 1.1,
        scale: 1.15,
        description: '圓滾滾的福態身軀，游動時雙層大尾巴宛如花瓣般飄逸。'
    },
    koi: {
        id: 'koi',
        name: '黃金錦鯉',
        nickname: '吉祥',
        price: 850,
        baseIncome: 20,
        incomeInterval: 8000,
        speed: 1.3,
        scale: 1.3,
        description: '象徵好運與財富的錦鯉，游動優雅，有機率掉落雙倍金幣！'
    },
    angelfish: {
        id: 'angelfish',
        name: '神仙魚',
        nickname: '凱撒',
        price: 1800,
        baseIncome: 45,
        incomeInterval: 8000,
        speed: 1.25,
        scale: 1.25,
        description: '高貴菱形身軀與修長腹鰭，是水族箱裡的水中貴族。'
    },
    jellyfish: {
        id: 'jellyfish',
        name: '幻彩水母',
        nickname: '星海',
        price: 3800,
        baseIncome: 100,
        incomeInterval: 8000,
        speed: 0.9,
        scale: 1.2,
        description: '散發夢幻霓光的水母，隨水流規律收縮跳動，產出豐厚金幣。'
    },
    custom: {
        id: 'custom',
        name: '自訂小魚',
        nickname: '神祕客',
        price: 200,
        baseIncome: 15,
        incomeInterval: 8000,
        speed: 1.3,
        scale: 1.1,
        description: '由飼主親自設計/上傳圖片的獨一無二小魚！'
    }
};

class Fish {
    constructor(data, bounds) {
        this.id = data.id || ('fish_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
        this.speciesId = data.speciesId || 'clownfish';
        this.species = FISH_SPECIES[this.speciesId] || FISH_SPECIES.clownfish;
        this.name = data.name || this.species.name;
        this.customImage = data.customImage || null; // Base64 or local image URL
        if (this.customImage) {
            FishImageCache.getImage(this.customImage);
        }
        
        // Status attributes
        this.hunger = (data.hunger !== undefined) ? data.hunger : 80;
        this.happiness = (data.happiness !== undefined) ? data.happiness : 85;
        this.growth = (data.growth !== undefined) ? data.growth : 30; // 0 - 100
        this.bornTime = data.bornTime || Date.now();
        this.coinsGeneratedTotal = data.coinsGeneratedTotal || 0;

        // Positioning & physics
        this.bounds = bounds || { width: 450, height: 350 };
        this.x = (data.x !== undefined) ? data.x : Math.random() * (this.bounds.width - 80) + 40;
        this.y = (data.y !== undefined) ? data.y : Math.random() * (this.bounds.height - 120) + 50;
        this.targetX = this.x;
        this.targetY = this.y;
        this.angle = Math.random() * Math.PI * 2;
        this.facing = Math.cos(this.angle) >= 0 ? 1 : -1;
        this.baseSpeed = this.species.speed;
        this.currentSpeed = this.baseSpeed * (0.9 + Math.random() * 0.4);

        // Active Swimming & Burst-and-Coast Physics
        this.tailPhase = Math.random() * Math.PI * 2;
        this.finPhase = Math.random() * Math.PI * 2;
        this.wavePhase = Math.random() * Math.PI * 2;
        this.jellyPulse = 0;
        this.state = 'WANDER';
        this.wanderTimer = 800 + Math.random() * 1500;
        this.burstTimer = 1000 + Math.random() * 2000;
        this.isBursting = false;
        this.burstDuration = 0;
        this.verticalWanderBias = (Math.random() - 0.5) * 0.8;
        this.incomeTimer = Math.random() * 5000;
        this.hungerDecayTimer = 0;
        this.isPetCelebration = 0;

        // Pre-cache image if custom
        if (this.customImage) {
            FishImageCache.getImage(this.customImage);
        }
    }

    update(dt, foods, particles, addCoinCallback, mousePos, dangerHand) {
        // 1. Hunger decay
        this.hungerDecayTimer += dt;
        if (this.hungerDecayTimer >= 15000) {
            this.hungerDecayTimer = 0;
            this.hunger = Math.max(0, this.hunger - 1);
            if (this.hunger < 30) {
                this.happiness = Math.max(10, this.happiness - 1);
            }
        }

        // 2. Idle coin generation
        if (this.hunger > 10) {
            this.incomeTimer += dt;
            if (this.incomeTimer >= this.species.incomeInterval) {
                this.incomeTimer = 0;
                let multiplier = 1;
                if (this.speciesId === 'koi' && Math.random() < 0.25) {
                    multiplier = 2; // Lucky Golden Koi
                }
                const earned = this.species.baseIncome * multiplier;
                this.coinsGeneratedTotal += earned;
                addCoinCallback(earned, this.x, this.y);
            }
        }

        // 3. Pet Celebration
        if (this.isPetCelebration > 0) {
            this.isPetCelebration -= dt;
            this.tailPhase += 0.45;
        }

        // 4. Burst-and-Coast (衝刺與自然滑行)
        this.burstTimer -= dt;
        if (this.burstTimer <= 0 && this.state !== 'CHASE_FOOD' && this.state !== 'FLEE_DANGER') {
            this.isBursting = true;
            this.burstDuration = 350 + Math.random() * 450;
            this.currentSpeed = this.baseSpeed * (1.8 + Math.random() * 0.9);
            this.burstTimer = 1800 + Math.random() * 2600;
        }

        if (this.isBursting) {
            this.burstDuration -= dt;
            if (this.burstDuration <= 0) {
                this.isBursting = false;
            }
        } else {
            // Fluid drag: gradually coast down to cruising speed
            const targetCruise = this.baseSpeed * (0.85 + Math.sin(this.wavePhase * 0.5) * 0.2);
            this.currentSpeed += (targetCruise - this.currentSpeed) * 0.05;
        }

        // 5. Threat avoidance (逃避貓爪/人手突發事件)
        let isFleeing = false;
        if (dangerHand && dangerHand.active) {
            const distToHand = Math.hypot(dangerHand.x - this.x, dangerHand.y - this.y);
            if (distToHand < 130) {
                isFleeing = true;
                this.state = 'FLEE_DANGER';
                this.isBursting = true;
                this.currentSpeed = this.baseSpeed * 2.8; // 快速逃離！
                const fleeAngle = Math.atan2(this.y - dangerHand.y, this.x - dangerHand.x);
                this.targetX = this.x + Math.cos(fleeAngle) * 120;
                this.targetY = this.y + Math.sin(fleeAngle) * 90;
                this.tailPhase += 0.5;
            }
        }

        // 6. Food Targeting & Eating (if not in immediate danger)
        let targetFood = null;
        if (!isFleeing && foods && foods.length > 0 && this.hunger < 98) {
            let closestDist = Infinity;
            for (let f of foods) {
                if (f.consumed) continue;
                const dist = Math.hypot(f.x - this.x, f.y - this.y);
                if (dist < closestDist) {
                    closestDist = dist;
                    targetFood = f;
                }
            }
        }

        if (!isFleeing && targetFood) {
            this.state = 'CHASE_FOOD';
            this.targetX = targetFood.x;
            this.targetY = targetFood.y;

            const dist = Math.hypot(targetFood.x - this.x, targetFood.y - this.y);
            if (dist < 22) {
                targetFood.consumed = true;
                const foodPower = targetFood.power || 25;
                this.hunger = Math.min(100, this.hunger + foodPower);
                this.happiness = Math.min(100, this.happiness + 15);
                this.growth = Math.min(100, this.growth + 3);

                if (window.soundCtrl) window.soundCtrl.playMunch();
                particles.addHeart(this.x, this.y - 15);
                particles.addFloatingText(this.x, this.y - 25, '+飽食度', '#4cd137');
                this.pickNewWanderTarget(particles);
            }
        } else if (!isFleeing) {
            // Mouse Interaction: Curious glance or playful scattering
            let mouseInteracting = false;
            if (mousePos && mousePos.x >= 0 && mousePos.y >= 0) {
                const distToMouse = Math.hypot(mousePos.x - this.x, mousePos.y - this.y);
                if (distToMouse < 85 && distToMouse > 25) {
                    // Curious approach
                    this.targetX = mousePos.x + (Math.random() - 0.5) * 20;
                    this.targetY = mousePos.y + (Math.random() - 0.5) * 20;
                    mouseInteracting = true;
                } else if (distToMouse <= 25) {
                    // Playful dart away!
                    this.isBursting = true;
                    this.currentSpeed = this.baseSpeed * 2.2;
                    this.targetX = this.x + (this.x - mousePos.x) * 2;
                    this.targetY = this.y + (this.y - mousePos.y) * 2;
                    mouseInteracting = true;
                }
            }

            if (!mouseInteracting) {
                this.state = 'WANDER';
                this.wanderTimer -= dt;
                if (this.wanderTimer <= 0) {
                    this.pickNewWanderTarget(particles);
                }
            }
        }

        // 6. Movement physics & Sinusoidal curved steering
        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const distToTarget = Math.hypot(dx, dy);

        let finalSpeed = this.currentSpeed;
        if (this.state === 'CHASE_FOOD') finalSpeed = this.baseSpeed * 2.1;
        if (this.hunger < 20) finalSpeed *= 0.65;
        
        if (this.speciesId === 'jellyfish') {
            this.jellyPulse += 0.06;
            const pulseSpeed = Math.sin(this.jellyPulse);
            finalSpeed = pulseSpeed > 0 ? pulseSpeed * 1.8 : 0.25;
        }

        // Natural S-wave swimming oscillations
        this.wavePhase += 0.08 * (finalSpeed / this.baseSpeed);
        const waveSteer = Math.sin(this.wavePhase) * 0.045;

        if (distToTarget > 6) {
            const desiredAngle = Math.atan2(dy, dx);
            let diff = desiredAngle - this.angle;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            
            // Agile steering factor: faster during bursts or food chase
            const steerRate = (this.isBursting || this.state === 'CHASE_FOOD') ? 0.16 : 0.11;
            this.angle += diff * steerRate + waveSteer;

            const moveStep = Math.min(distToTarget, finalSpeed * (dt / 16));
            this.x += Math.cos(this.angle) * moveStep;
            this.y += Math.sin(this.angle) * moveStep;
            this.facing = Math.cos(this.angle) >= 0 ? 1 : -1;
        } else {
            // When close to target, immediately pick new target or pivot smoothly
            if (this.state === 'WANDER') {
                this.pickNewWanderTarget(particles);
            }
        }

        // Tank bounds constraint with soft bounce-turn
        const padX = 35;
        const padTop = 32;
        const padBottom = 48;
        if (this.x <= padX) {
            this.x = padX;
            this.angle = 0 + (Math.random() - 0.5) * 0.8;
            this.targetX = this.bounds.width * 0.5;
        } else if (this.x >= this.bounds.width - padX) {
            this.x = this.bounds.width - padX;
            this.angle = Math.PI + (Math.random() - 0.5) * 0.8;
            this.targetX = this.bounds.width * 0.5;
        }

        if (this.y <= padTop) {
            this.y = padTop;
            this.angle = Math.PI * 0.5 + (Math.random() - 0.5) * 0.6;
            this.targetY = this.bounds.height * 0.5;
        } else if (this.y >= this.bounds.height - padBottom) {
            this.y = this.bounds.height - padBottom;
            this.angle = -Math.PI * 0.5 + (Math.random() - 0.5) * 0.6;
            this.targetY = this.bounds.height * 0.5;
        }

        // Tail oscillation frequency scales directly with instantaneous speed
        const tailSpeedFactor = (0.16 + (finalSpeed / this.baseSpeed) * 0.22);
        this.tailPhase += tailSpeedFactor;
        this.finPhase += 0.18;
    }

    pickNewWanderTarget(particles) {
        // Shorter wander timer for energetic, agile changes (1.2 ~ 2.6s)
        this.wanderTimer = 1200 + Math.random() * 1400;
        const padX = 40;
        const padTop = 38;
        const padBottom = 55;

        // Dynamic 3D depth explorations
        const roll = Math.random();

        if (roll < 0.22) {
            // 1. Deep Dive: swim down to inspect plants & bottom sand
            this.targetX = padX + Math.random() * (this.bounds.width - padX * 2);
            this.targetY = this.bounds.height - padBottom - Math.random() * 35;
        } else if (roll < 0.42) {
            // 2. Surface Cruising: swim up near the water surface and emit a tiny bubble
            this.targetX = padX + Math.random() * (this.bounds.width - padX * 2);
            this.targetY = padTop + Math.random() * 25;
            if (particles && Math.random() < 0.35) {
                particles.addBubble(this.x, this.y, 1.8 + Math.random() * 1.5, 0.9);
            }
        } else if (roll < 0.62) {
            // 3. Playful Agile Swerve / Wide Arc
            const turnAngle = this.angle + (Math.random() > 0.5 ? 1 : -1) * (Math.PI * 0.4 + Math.random() * 0.5);
            const dist = 60 + Math.random() * 100;
            this.targetX = Math.max(padX, Math.min(this.bounds.width - padX, this.x + Math.cos(turnAngle) * dist));
            this.targetY = Math.max(padTop, Math.min(this.bounds.height - padBottom, this.y + Math.sin(turnAngle) * dist));
        } else {
            // 4. Active Cross-Tank Cruising
            this.targetX = padX + Math.random() * (this.bounds.width - padX * 2);
            this.targetY = padTop + Math.random() * (this.bounds.height - padTop - padBottom);
        }
    }

    pet() {
        this.happiness = Math.min(100, this.happiness + 20);
        this.isPetCelebration = 1000;
        if (window.soundCtrl) window.soundCtrl.playHappyPurr();
    }

    updateData(data) {
        if (data.name !== undefined) this.name = data.name;
        if (data.speciesId !== undefined) {
            this.speciesId = data.speciesId;
            this.species = FISH_SPECIES[this.speciesId] || FISH_SPECIES.clownfish;
            this.baseSpeed = this.species.speed;
        }
        if (data.customImage !== undefined) {
            this.customImage = data.customImage;
            if (this.customImage) {
                FishImageCache.getImage(this.customImage);
            }
        }
    }

    containsPoint(px, py) {
        const size = (26 + this.growth * 0.1) * this.species.scale;
        const d = Math.hypot(px - this.x, py - this.y);
        return d <= size;
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        if (this.isPetCelebration > 0) {
            ctx.rotate(Math.sin(this.tailPhase * 2) * 0.3);
        }

        ctx.scale(this.facing, 1);

        const tilt = Math.sin(this.angle) * 0.35 * this.facing;
        ctx.rotate(tilt);

        const growthScale = (1.0 + (this.growth / 100) * 0.28) * this.species.scale;
        ctx.scale(growthScale, growthScale);

        // Check if custom image exists
        if (this.customImage) {
            this.drawCustomImage(ctx);
        } else {
            // Draw procedural species
            switch (this.speciesId) {
                case 'clownfish':
                    this.drawClownfish(ctx);
                    break;
                case 'bluetang':
                    this.drawBlueTang(ctx);
                    break;
                case 'goldfish':
                    this.drawGoldfish(ctx);
                    break;
                case 'koi':
                    this.drawKoi(ctx);
                    break;
                case 'angelfish':
                    this.drawAngelfish(ctx);
                    break;
                case 'jellyfish':
                    this.drawJellyfish(ctx);
                    break;
                default:
                    this.drawClownfish(ctx);
            }
        }

        ctx.restore();

        // Starving indicator
        if (this.hunger < 25) {
            this.drawHungerBubble(ctx);
        }
    }

    drawCustomImage(ctx) {
        const img = FishImageCache.getImage(this.customImage);
        if (img && img.loaded) {
            ctx.save();
            // Subtle swimming wiggle for custom image
            const bobbing = Math.sin(this.tailPhase) * 2;
            const wobble = Math.sin(this.tailPhase * 0.8) * 0.08;
            ctx.rotate(wobble);

            const drawWidth = 52;
            const aspect = (img.height && img.width) ? (img.height / img.width) : 0.6;
            const drawHeight = drawWidth * aspect;

            ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2 + bobbing, drawWidth, drawHeight);
            ctx.restore();
        } else if (img && img.error) {
            // Friendly fallback if image URL cannot be reached or expired
            ctx.save();
            ctx.fillStyle = 'rgba(255, 107, 129, 0.85)';
            ctx.beginPath();
            ctx.ellipse(0, 0, 20, 12, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('圖片失聯', 0, 3);
            ctx.restore();
        } else {
            // Loading placeholder while image loads
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.beginPath();
            ctx.arc(0, 0, 16, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#333';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('載入中', 0, 4);
        }
    }

    drawHungerBubble(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y - 32);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(4, 8, 2, 0, Math.PI * 2);
        ctx.arc(8, 4, 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(5, -16, 26, 18, 6) : ctx.rect(5, -16, 26, 18);
        ctx.fill();
        ctx.strokeStyle = '#3498db';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.font = '12px sans-serif';
        ctx.fillText('🦐', 10, -3);
        ctx.restore();
    }

    /* ---------------- Procedural Vector Renderers ---------------- */

    drawClownfish(ctx) {
        const tailWag = Math.sin(this.tailPhase) * 6;

        ctx.save();
        ctx.translate(-22, 0);
        ctx.rotate(tailWag * 0.05);
        ctx.fillStyle = '#ff6b35';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-12, -10, -18, -12);
        ctx.quadraticCurveTo(-14, 0, -18, 12);
        ctx.quadraticCurveTo(-12, 10, 0, 0);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.strokeStyle = '#1e272e';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#ff5400';
        ctx.beginPath();
        ctx.moveTo(-5, -11);
        ctx.quadraticCurveTo(4, -18, 10, -10);
        ctx.lineTo(-5, -11);
        ctx.fill();

        ctx.fillStyle = '#ff6b35';
        ctx.beginPath();
        ctx.ellipse(0, 0, 22, 13, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#2f3542';
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.ellipse(8, 0, 3.5, 12, 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(-4, 0, 4, 13, -0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(-16, 0, 2.5, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        const finWag = Math.sin(this.finPhase) * 0.25;
        ctx.save();
        ctx.translate(4, 4);
        ctx.rotate(finWag);
        ctx.fillStyle = 'rgba(255, 107, 53, 0.9)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 4, 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(13, -3, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1e272e';
        ctx.beginPath();
        ctx.arc(14, -3, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(14.8, -3.8, 0.8, 0, Math.PI * 2);
        ctx.fill();
    }

    drawBlueTang(ctx) {
        const tailWag = Math.sin(this.tailPhase) * 6;

        ctx.save();
        ctx.translate(-24, 0);
        ctx.rotate(tailWag * 0.05);
        ctx.fillStyle = '#f1c40f';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-16, -11);
        ctx.lineTo(-13, 0);
        ctx.lineTo(-16, 11);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#2c3e50';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#0984e3';
        ctx.beginPath();
        ctx.ellipse(0, 0, 24, 15, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#2d3436';
        ctx.beginPath();
        ctx.moveTo(12, -8);
        ctx.quadraticCurveTo(-6, -14, -18, -4);
        ctx.quadraticCurveTo(-10, 0, -18, 6);
        ctx.quadraticCurveTo(-4, 12, 10, 8);
        ctx.quadraticCurveTo(0, 0, 12, -8);
        ctx.fill();

        ctx.fillStyle = '#ffeaa7';
        ctx.beginPath();
        ctx.ellipse(-10, 0, 6, 3, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(6, 4);
        ctx.rotate(Math.sin(this.finPhase) * 0.3);
        ctx.fillStyle = '#fed330';
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 3.5, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(15, -4, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2d3436';
        ctx.beginPath();
        ctx.arc(16, -4, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(16.8, -4.8, 0.8, 0, Math.PI * 2);
        ctx.fill();
    }

    drawGoldfish(ctx) {
        const tailWag = Math.sin(this.tailPhase * 0.8) * 8;
        const subWag = Math.cos(this.tailPhase * 0.8) * 5;

        ctx.save();
        ctx.translate(-20, 2);
        ctx.rotate(tailWag * 0.04);

        ctx.fillStyle = 'rgba(255, 118, 117, 0.65)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-15, 10 + subWag, -25, 20 + tailWag, -32, 18);
        ctx.bezierCurveTo(-22, 10, -18, 2, 0, 0);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 99, 72, 0.85)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(-15, -8 - subWag, -28, -16 + tailWag, -35, -12);
        ctx.bezierCurveTo(-25, -4, -15, 0, 0, 0);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#ff4757';
        ctx.beginPath();
        ctx.ellipse(0, 1, 21, 17, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 242, 240, 0.55)';
        ctx.beginPath();
        ctx.ellipse(4, 6, 14, 8, 0.1, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 71, 87, 0.8)';
        ctx.beginPath();
        ctx.moveTo(-8, -16);
        ctx.quadraticCurveTo(0, -23, 8, -14);
        ctx.lineTo(-8, -16);
        ctx.fill();

        ctx.save();
        ctx.translate(6, 6);
        ctx.rotate(Math.sin(this.finPhase) * 0.35);
        ctx.fillStyle = 'rgba(255, 118, 117, 0.75)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 8, 5, 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#2f3542';
        ctx.beginPath();
        ctx.arc(13, -4, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(14.2, -5.2, 1.6, 0, Math.PI * 2);
        ctx.arc(12.5, -3, 0.9, 0, Math.PI * 2);
        ctx.fill();
    }

    drawKoi(ctx) {
        const tailWag = Math.sin(this.tailPhase * 0.9) * 7;

        ctx.save();
        ctx.translate(-26, 0);
        ctx.rotate(tailWag * 0.04);
        ctx.fillStyle = 'rgba(250, 177, 160, 0.85)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(-14, -12, -26, -10);
        ctx.quadraticCurveTo(-18, 0, -26, 10);
        ctx.quadraticCurveTo(-14, 12, 0, 0);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#f8f9fa';
        ctx.beginPath();
        ctx.ellipse(0, 0, 27, 12, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#e17055';
        ctx.beginPath();
        ctx.ellipse(8, -3, 7, 5, 0.3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#f39c12';
        ctx.beginPath();
        ctx.ellipse(-6, 2, 9, 6, -0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#d63031';
        ctx.beginPath();
        ctx.ellipse(-15, -2, 5, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#ffeaa7';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(25, 2);
        ctx.quadraticCurveTo(28, 5, 30, 8);
        ctx.moveTo(25, -2);
        ctx.quadraticCurveTo(28, -5, 30, -8);
        ctx.stroke();

        ctx.save();
        ctx.translate(8, 4);
        ctx.rotate(Math.sin(this.finPhase) * 0.25);
        ctx.fillStyle = 'rgba(255, 234, 167, 0.8)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 9, 4, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#2d3436';
        ctx.beginPath();
        ctx.arc(18, -4, 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(19, -4.8, 1, 0, Math.PI * 2);
        ctx.fill();
    }

    drawAngelfish(ctx) {
        const tailWag = Math.sin(this.tailPhase * 0.7) * 4;

        ctx.save();
        ctx.translate(-18, 0);
        ctx.rotate(tailWag * 0.05);
        ctx.fillStyle = 'rgba(164, 176, 190, 0.7)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-14, -10);
        ctx.lineTo(-11, 0);
        ctx.lineTo(-14, 10);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#1e3799';
        ctx.beginPath();
        ctx.moveTo(-6, -10);
        ctx.lineTo(2, -26);
        ctx.lineTo(10, -8);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#4a69bd';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.strokeStyle = '#f6b93b';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(4, 10);
        ctx.quadraticCurveTo(0, 24, -8, 30);
        ctx.stroke();

        ctx.fillStyle = '#74b9ff';
        ctx.beginPath();
        ctx.ellipse(0, 0, 18, 15, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0c2461';
        ctx.fillRect(-2, -14, 3, 28);
        ctx.fillRect(8, -10, 2.5, 20);
        ctx.fillRect(-10, -8, 2.5, 16);

        ctx.fillStyle = '#e74c3c';
        ctx.beginPath();
        ctx.arc(12, -3, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1e272e';
        ctx.beginPath();
        ctx.arc(12.5, -3, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(13.2, -3.6, 0.8, 0, Math.PI * 2);
        ctx.fill();
    }

    drawJellyfish(ctx) {
        const pulse = Math.sin(this.jellyPulse);
        const w = 18 + pulse * 3;
        const h = 16 - pulse * 2;

        const gradient = ctx.createRadialGradient(0, -4, 2, 0, 0, 22);
        gradient.addColorStop(0, 'rgba(162, 155, 254, 0.9)');
        gradient.addColorStop(0.6, 'rgba(0, 206, 201, 0.75)');
        gradient.addColorStop(1, 'rgba(108, 92, 231, 0.15)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, -2, w, Math.PI, 0, false);
        ctx.quadraticCurveTo(w * 0.5, h * 0.5, 0, h * 0.4);
        ctx.quadraticCurveTo(-w * 0.5, h * 0.5, -w, -2);
        ctx.fill();

        ctx.strokeStyle = '#81ecec';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const wave = Math.sin(this.tailPhase * 0.8);
        ctx.lineWidth = 1.2;
        const tentacleColors = ['#a29bfe', '#81ecec', '#fd79a8'];
        for (let i = -2; i <= 2; i++) {
            const startX = i * 4;
            ctx.strokeStyle = tentacleColors[(i + 2) % tentacleColors.length];
            ctx.beginPath();
            ctx.moveTo(startX, 4);
            ctx.bezierCurveTo(
                startX + wave * 4, 14,
                startX - wave * 4, 24,
                startX + wave * 6, 32
            );
            ctx.stroke();
        }
    }
}

window.FISH_SPECIES = FISH_SPECIES;
window.Fish = Fish;
window.FishImageCache = FishImageCache;
