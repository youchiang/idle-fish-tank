/**
 * Particle and Aquarium Decoration System
 * Handles:
 * - Food pellets (physics, sinking, dissolving)
 * - Rising bubbles from air stone / pump
 * - Floating text particles (+🪙, +XP, ❤️)
 * - Swaying kelp/seaweed plants
 * - Sunlight caustics & underwater ambience
 */

class FoodPellet {
    constructor(x, y, tier) {
        this.x = x;
        this.y = y;
        this.tier = tier || 1;
        this.consumed = false;
        this.vy = 0.5 + Math.random() * 0.3;
        this.vx = (Math.random() - 0.5) * 0.4;
        this.wobblePhase = Math.random() * Math.PI * 2;
        this.groundTimer = 0; // ms sitting on floor
        this.lifespan = 25000; // dissolve after 25s if untouched

        // Properties based on tier
        switch (this.tier) {
            case 2: // 凍乾蝦粒
                this.color = '#ff7675';
                this.power = 35;
                this.radius = 3.5;
                break;
            case 3: // 螺旋藻大餐
                this.color = '#00b894';
                this.power = 55;
                this.radius = 4;
                break;
            case 4: // 皇家金饌
                this.color = '#f1c40f';
                this.power = 85;
                this.radius = 4.5;
                break;
            default: // 基礎片狀
                this.color = '#e17055';
                this.power = 22;
                this.radius = 3;
                break;
        }
    }

    update(dt, floorY) {
        this.lifespan -= dt;
        if (this.lifespan <= 0) {
            this.consumed = true;
            return;
        }

        if (this.y < floorY - this.radius) {
            // Sinking through water
            this.wobblePhase += 0.08;
            this.y += this.vy * (dt / 16);
            this.x += (this.vx + Math.sin(this.wobblePhase) * 0.25) * (dt / 16);
        } else {
            // Settled on bottom
            this.y = floorY - this.radius;
            this.groundTimer += dt;
        }
    }

    draw(ctx) {
        if (this.consumed) return;
        ctx.save();
        ctx.translate(this.x, this.y);

        // Food pellet glow for higher tiers
        if (this.tier >= 3) {
            ctx.shadowColor = this.color;
            ctx.shadowBlur = 6;
        }

        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fill();

        // Highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(-this.radius * 0.3, -this.radius * 0.3, this.radius * 0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

class Bubble {
    constructor(x, y, r, speed) {
        this.x = x;
        this.y = y;
        this.radius = r || (1.5 + Math.random() * 3.5);
        this.speed = speed || (0.8 + Math.random() * 1.2);
        this.wobble = Math.random() * Math.PI * 2;
        this.wobbleSpeed = 0.05 + Math.random() * 0.05;
        this.dead = false;
    }

    update(dt, surfaceY) {
        this.y -= this.speed * (dt / 16);
        this.wobble += this.wobbleSpeed;
        this.x += Math.sin(this.wobble) * 0.4;

        if (this.y <= surfaceY) {
            this.dead = true;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Bubble gleam
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.beginPath();
        ctx.arc(this.x - this.radius * 0.35, this.y - this.radius * 0.35, this.radius * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class FloatingText {
    constructor(x, y, text, color, fontSize = 14) {
        this.x = x;
        this.y = y;
        this.text = text;
        this.color = color || '#ffd700';
        this.fontSize = fontSize;
        this.alpha = 1.0;
        this.vy = -0.8;
        this.dead = false;
    }

    update(dt) {
        this.y += this.vy * (dt / 16);
        this.alpha -= 0.02 * (dt / 16);
        if (this.alpha <= 0) {
            this.dead = true;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.alpha);
        ctx.font = `bold ${this.fontSize}px 'Segoe UI', system-ui, sans-serif`;
        ctx.fillStyle = this.color;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
        ctx.shadowBlur = 4;
        ctx.textAlign = 'center';
        ctx.fillText(this.text, this.x, this.y);
        ctx.restore();
    }
}

class KelpPlant {
    constructor(x, baseY, height, segments = 7, color = '#20bf6b') {
        this.x = x;
        this.baseY = baseY;
        this.height = height;
        this.segments = segments;
        this.color = color;
        this.segLength = height / segments;
        this.phase = Math.random() * Math.PI * 2;
    }

    update(time) {
        this.phase += 0.03;
    }

    draw(ctx) {
        ctx.save();
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.strokeStyle = this.color;

        ctx.beginPath();
        ctx.moveTo(this.x, this.baseY);

        let curX = this.x;
        let curY = this.baseY;

        for (let i = 1; i <= this.segments; i++) {
            const sway = Math.sin(this.phase + i * 0.45) * (i * 2.5);
            curX = this.x + sway;
            curY = this.baseY - i * this.segLength;
            ctx.lineTo(curX, curY);
        }
        ctx.stroke();

        // Draw leaves on joints
        for (let i = 1; i < this.segments; i++) {
            const jointY = this.baseY - i * this.segLength;
            const jointX = this.x + Math.sin(this.phase + i * 0.45) * (i * 2.5);
            const leafDir = (i % 2 === 0) ? 1 : -1;
            const leafSway = Math.sin(this.phase + i) * 3;

            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.ellipse(
                jointX + leafDir * 10,
                jointY + leafSway,
                9,
                4,
                leafDir * 0.4,
                0,
                Math.PI * 2
            );
            ctx.fill();
        }
        ctx.restore();
    }
}

class ParticleManager {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.surfaceY = 25;
        this.floorY = height - 25;

        this.foods = [];
        this.bubbles = [];
        this.floatingTexts = [];
        this.plants = [];

        this.bubbleTimer = 0;
        this.causticsPhase = 0;
        this.initPlants(5);

        // 突發抓魚手事件狀態
        this.invasion = {
            active: false,
            timeLeft: 10,
            totalTime: 10,
            x: width * 0.5,
            y: -80,
            targetY: 140,
            recoilY: 0,
            shake: 0,
            hitCount: 0,
            targetHits: 8,
            handType: 'orangeCat', // orangeCat, tuxedoCat, human, custom
            customHandUrl: '',
            clawPhase: 0,
            resultPending: null // 'success' | 'failed'
        };
    }

    initPlants(count = 5) {
        this.plants = [];
        const basePlants = [
            { xRatio: 0.08, h: 115, seg: 8, col: '#10ac84' },
            { xRatio: 0.14, h: 90, seg: 6, col: '#1dd1a1' },
            { xRatio: 0.20, h: 130, seg: 9, col: '#00b894' },
            { xRatio: 0.82, h: 125, seg: 8, col: '#10ac84' },
            { xRatio: 0.88, h: 95, seg: 6, col: '#1dd1a1' },
            { xRatio: 0.28, h: 105, seg: 7, col: '#10ac84' },
            { xRatio: 0.75, h: 110, seg: 8, col: '#00b894' }
        ];
        const num = Math.min(count, basePlants.length);
        for (let i = 0; i < num; i++) {
            const p = basePlants[i];
            this.plants.push(new KelpPlant(this.width * p.xRatio, this.floorY, p.h, p.seg, p.col));
        }
    }

    resize(w, h) {
        this.width = w;
        this.height = h;
        this.floorY = h - 25;
        this.initPlants();
    }

    // 觸發捕魚手突發事件 (10秒)
    startInvasion(options = {}) {
        this.invasion.active = true;
        this.invasion.timeLeft = 10;
        this.invasion.totalTime = 10;
        this.invasion.x = this.width * (0.3 + Math.random() * 0.4);
        this.invasion.y = -70;
        this.invasion.targetY = this.height * 0.48;
        this.invasion.recoilY = 0;
        this.invasion.shake = 0;
        this.invasion.hitCount = 0;
        this.invasion.targetHits = 8;
        this.invasion.handType = options.handType || 'orangeCat';
        this.invasion.customHandUrl = options.customHandUrl || '';
        this.invasion.resultPending = null;

        // 水花飛濺
        for (let i = 0; i < 16; i++) {
            this.addBubble(this.invasion.x + (Math.random() - 0.5) * 40, this.surfaceY + 10, 2 + Math.random() * 3, 1.8 + Math.random() * 1.5);
        }
    }

    // 點擊判定：是否擊中捕魚手
    checkHitHand(clickX, clickY) {
        if (!this.invasion.active) return false;
        const currentY = this.invasion.y - this.invasion.recoilY;
        const handBox = {
            left: this.invasion.x - 38,
            right: this.invasion.x + 38,
            top: currentY - 40,
            bottom: currentY + 45
        };

        if (clickX >= handBox.left && clickX <= handBox.right &&
            clickY >= handBox.top && clickY <= handBox.bottom) {
            
            this.invasion.hitCount++;
            // 向上被擊退反衝
            this.invasion.recoilY = Math.min(100, this.invasion.recoilY + 42);
            this.invasion.shake = 14;

            // 冒出受擊火花與愛心水花
            this.addFloatingText(clickX, clickY - 10, '💥 啪！防禦！', '#ff4757', 16);
            for (let i = 0; i < 6; i++) {
                this.addBubble(clickX + (Math.random() - 0.5) * 25, clickY + (Math.random() - 0.5) * 15, 2 + Math.random() * 2, 1.5);
            }
            return true;
        }
        return false;
    }

    addFood(x, y, tier = 1) {
        this.foods.push(new FoodPellet(x, y, tier));
    }

    addBubble(x, y, r, speed) {
        this.bubbles.push(new Bubble(x, y, r, speed));
    }

    addFloatingText(x, y, text, color, fontSize) {
        this.floatingTexts.push(new FloatingText(x, y, text, color, fontSize));
    }

    addHeart(x, y) {
        this.floatingTexts.push(new FloatingText(x, y, '❤️', '#ff4757', 16));
    }

    addCoinParticle(x, y, amount) {
        this.floatingTexts.push(new FloatingText(x, y, `+🪙${amount}`, '#ffd700', 15));
    }

    update(dt, decorations = {}) {
        // 1. Food update
        for (let i = this.foods.length - 1; i >= 0; i--) {
            this.foods[i].update(dt, this.floorY);
            if (this.foods[i].consumed) {
                this.foods.splice(i, 1);
            }
        }

        // 2. Continuous bubbles from bottom filter/airstone
        this.bubbleTimer += dt;
        const bubbleInterval = decorations.airStone !== false ? 80 : 220;
        if (this.bubbleTimer >= bubbleInterval) {
            this.bubbleTimer = 0;
            const stoneXRatio = (decorations.airStoneX !== undefined) ? decorations.airStoneX : 0.9;
            const airStoneX = this.width * stoneXRatio;
            this.addBubble(airStoneX + (Math.random() - 0.5) * 16, this.floorY, 1.5 + Math.random() * 3, 1.2 + Math.random() * 1.0);
            
            if (Math.random() < 0.35) {
                this.addBubble(Math.random() * this.width, this.floorY, 1 + Math.random() * 2, 0.7 + Math.random() * 0.8);
            }
        }

        // 3. Bubbles update
        for (let i = this.bubbles.length - 1; i >= 0; i--) {
            this.bubbles[i].update(dt, this.surfaceY);
            if (this.bubbles[i].dead) {
                this.bubbles.splice(i, 1);
            }
        }

        // 4. Floating text
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            this.floatingTexts[i].update(dt);
            if (this.floatingTexts[i].dead) {
                this.floatingTexts.splice(i, 1);
            }
        }

        // 5. Swaying plants
        this.plants.forEach(p => p.update(dt));

        // 6. Caustics shimmer
        this.causticsPhase += 0.02;

        // 7. 突發抓魚手物理更新 (10秒倒數)
        if (this.invasion.active) {
            this.invasion.timeLeft -= dt / 1000;
            this.invasion.clawPhase += 0.15;

            // 受擊反衝自然沉降
            if (this.invasion.recoilY > 0) {
                this.invasion.recoilY = Math.max(0, this.invasion.recoilY - dt * 0.08);
            }

            // 震顫阻尼
            if (this.invasion.shake > 0) {
                this.invasion.shake = Math.max(0, this.invasion.shake - dt * 0.05);
            }

            // 手爪向水下緩緩下伸
            if (this.invasion.y < this.invasion.targetY) {
                this.invasion.y += (dt / 16) * 1.6;
            }

            // 左右伺機微晃
            this.invasion.x += Math.sin(this.invasion.clawPhase * 0.4) * 0.5;

            // 10 秒時間到判定
            if (this.invasion.timeLeft <= 0) {
                this.invasion.active = false;
                // 如果防禦次數達到或手被擊退在上層
                if (this.invasion.hitCount >= 5 || this.invasion.recoilY > 20) {
                    this.invasion.resultPending = 'success';
                } else {
                    this.invasion.resultPending = 'failed';
                }
            }
        }
    }

    drawBackground(ctx, cleanliness = 100, decorations = {}) {
        const theme = decorations.theme || 'ocean';
        const sandType = decorations.sandType || 'gold';

        // 1. Water gradient by theme
        const bgGrad = ctx.createLinearGradient(0, 0, 0, this.height);
        
        if (cleanliness < 40) {
            bgGrad.addColorStop(0, '#134e4a');
            bgGrad.addColorStop(0.5, '#042f2e');
            bgGrad.addColorStop(1, '#0f172a');
        } else {
            switch (theme) {
                case 'emerald': // 熱帶翡翠綠
                    bgGrad.addColorStop(0, '#00b894');
                    bgGrad.addColorStop(0.4, '#006266');
                    bgGrad.addColorStop(1, '#012b2b');
                    break;
                case 'abyss': // 午夜幽深深海
                    bgGrad.addColorStop(0, '#1e272e');
                    bgGrad.addColorStop(0.4, '#0c2461');
                    bgGrad.addColorStop(1, '#050811');
                    break;
                case 'sunset': // 夕陽霞光
                    bgGrad.addColorStop(0, '#e17055');
                    bgGrad.addColorStop(0.4, '#d63031');
                    bgGrad.addColorStop(1, '#2c2c54');
                    break;
                case 'cyber': // 賽博霓虹
                    bgGrad.addColorStop(0, '#6c5ce7');
                    bgGrad.addColorStop(0.4, '#2d3436');
                    bgGrad.addColorStop(1, '#090a0f');
                    break;
                default: // 經典蔚藍
                    bgGrad.addColorStop(0, '#0984e3');
                    bgGrad.addColorStop(0.4, '#0a3d62');
                    bgGrad.addColorStop(1, '#051937');
                    break;
            }
        }
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, this.width, this.height);

        // Sunlight caustics
        this.drawCaustics(ctx);

        // Water surface line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = 0; x <= this.width; x += 10) {
            const waveY = this.surfaceY + Math.sin(this.causticsPhase * 2 + x * 0.04) * 2;
            if (x === 0) ctx.moveTo(x, waveY);
            else ctx.lineTo(x, waveY);
        }
        ctx.stroke();

        // 2. Sandy bottom substrate by sandType
        const sandGrad = ctx.createLinearGradient(0, this.floorY - 10, 0, this.height);
        let pebbleColor = '#6d5940';

        switch (sandType) {
            case 'white': // 白瓷細石
                sandGrad.addColorStop(0, '#f5f6fa');
                sandGrad.addColorStop(1, '#dcdde1');
                pebbleColor = '#b2bec3';
                break;
            case 'black': // 黑曜火山岩
                sandGrad.addColorStop(0, '#2f3542');
                sandGrad.addColorStop(1, '#1e272e');
                pebbleColor = '#57606f';
                break;
            case 'candy': // 彩色糖果砂
                sandGrad.addColorStop(0, '#ff9ff3');
                sandGrad.addColorStop(1, '#54a0ff');
                pebbleColor = '#feca57';
                break;
            default: // 天然黃金沙
                sandGrad.addColorStop(0, '#d2b48c');
                sandGrad.addColorStop(1, '#8b7355');
                pebbleColor = '#6d5940';
                break;
        }

        ctx.fillStyle = sandGrad;
        ctx.beginPath();
        ctx.moveTo(0, this.floorY);
        ctx.bezierCurveTo(this.width * 0.3, this.floorY - 6, this.width * 0.7, this.floorY + 4, this.width, this.floorY);
        ctx.lineTo(this.width, this.height);
        ctx.lineTo(0, this.height);
        ctx.fill();

        // Decorative pebbles
        ctx.fillStyle = pebbleColor;
        ctx.beginPath();
        ctx.arc(100, this.floorY + 8, 4.5, 0, Math.PI * 2);
        ctx.arc(112, this.floorY + 11, 3, 0, Math.PI * 2);
        ctx.arc(this.width * 0.58, this.floorY + 9, 6, 0, Math.PI * 2);
        ctx.arc(this.width * 0.62, this.floorY + 12, 4, 0, Math.PI * 2);
        ctx.fill();

        // Air stone pump gadget
        if (decorations.airStone !== false) {
            const stoneXRatio = (decorations.airStoneX !== undefined) ? decorations.airStoneX : 0.9;
            const airStoneX = this.width * stoneXRatio;
            ctx.fillStyle = '#7f8c8d';
            ctx.fillRect(airStoneX - 9, this.floorY - 6, 18, 10);
            ctx.fillStyle = '#95a5a6';
            ctx.fillRect(airStoneX - 6, this.floorY - 9, 12, 3);
        }

        // Draw Coral decoration
        if (decorations.coral) {
            const coralX = this.width * ((decorations.coralX !== undefined) ? decorations.coralX : 0.35);
            this.drawCoral(ctx, coralX, this.floorY);
        }

        // Draw Sunken Castle decoration
        if (decorations.sunkenCastle) {
            const castleX = this.width * ((decorations.castleX !== undefined) ? decorations.castleX : 0.55);
            this.drawCastle(ctx, castleX, this.floorY);
        }

        // Draw Custom imported decorations (URL / Image)
        if (Array.isArray(decorations.customDecorations)) {
            decorations.customDecorations.forEach(cd => {
                if (cd.enabled !== false && cd.imageUrl) {
                    this.drawCustomDecoration(ctx, cd);
                }
            });
        }

        // Draw Seaweed plants (background layer)
        if (decorations.seaweed !== false) {
            const count = decorations.seaweedCount || 5;
            if (this.plants.length !== count) {
                this.initPlants(count);
            }
            this.plants.forEach(p => p.draw(ctx));
        }

        // Murkiness overlay if dirty
        if (cleanliness < 70) {
            const dirtAlpha = (70 - cleanliness) / 100 * 0.45;
            ctx.fillStyle = `rgba(38, 70, 83, ${dirtAlpha})`;
            ctx.fillRect(0, 0, this.width, this.height);
        }
    }

    drawCustomDecoration(ctx, cd) {
        const img = window.FishImageCache ? window.FishImageCache.getImage(cd.imageUrl) : null;
        const xPos = this.width * (cd.xRatio !== undefined ? cd.xRatio : 0.5);
        const scale = cd.scale || 1.0;

        if (img && img.loaded) {
            ctx.save();
            const w = 60 * scale;
            const aspect = (img.height && img.width) ? (img.height / img.width) : 1.0;
            const h = w * aspect;
            ctx.drawImage(img, xPos - w / 2, this.floorY - h + 6, w, h);
            ctx.restore();
        } else {
            // Placeholder box while loading
            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.strokeStyle = '#00cec9';
            ctx.lineWidth = 1;
            ctx.strokeRect(xPos - 20, this.floorY - 40, 40, 40);
            ctx.fillStyle = '#81ecec';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(cd.name || '造景', xPos, this.floorY - 18);
            ctx.restore();
        }
    }

    drawCaustics(ctx) {
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = '#ffffff';

        for (let i = 0; i < 4; i++) {
            const xOffset = ((i * 120 + Math.sin(this.causticsPhase + i) * 35) % this.width);
            ctx.beginPath();
            ctx.moveTo(xOffset, 0);
            ctx.lineTo(xOffset + 35, 0);
            ctx.lineTo(xOffset + 95, this.height);
            ctx.lineTo(xOffset + 40, this.height);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }

    drawCoral(ctx, x, y) {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#ff7675';
        ctx.beginPath();
        ctx.arc(-8, -12, 9, 0, Math.PI * 2);
        ctx.arc(0, -22, 12, 0, Math.PI * 2);
        ctx.arc(10, -14, 8, 0, Math.PI * 2);
        ctx.arc(6, -6, 10, 0, Math.PI * 2);
        ctx.arc(-6, -5, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fab1a0';
        ctx.beginPath();
        ctx.arc(0, -22, 5, 0, Math.PI * 2);
        ctx.arc(-8, -12, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    drawCastle(ctx, x, y) {
        ctx.save();
        ctx.translate(x, y - 28);
        ctx.fillStyle = '#636e72';
        ctx.fillRect(-16, 8, 32, 20);
        ctx.fillRect(-18, 0, 10, 28);
        ctx.fillRect(8, 0, 10, 28);
        ctx.fillStyle = '#0984e3';
        ctx.beginPath();
        ctx.moveTo(-18, 0); ctx.lineTo(-13, -12); ctx.lineTo(-8, 0); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(8, 0); ctx.lineTo(13, -12); ctx.lineTo(18, 0); ctx.fill();
        ctx.fillStyle = '#2d3436';
        ctx.beginPath();
        ctx.arc(0, 20, 5, Math.PI, 0);
        ctx.lineTo(5, 28);
        ctx.lineTo(-5, 28);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    drawForeground(ctx) {
        // Draw food pellets
        this.foods.forEach(f => f.draw(ctx));

        // Draw rising bubbles
        this.bubbles.forEach(b => b.draw(ctx));

        // Draw floating text particles
        this.floatingTexts.forEach(t => t.draw(ctx));

        // Draw 突發捕魚手事件 (Invasion Cat/Human Hand)
        if (this.invasion.active) {
            this.drawInvasionHand(ctx);
        }
    }

    drawInvasionHand(ctx) {
        ctx.save();
        const shakeX = (Math.random() - 0.5) * this.invasion.shake;
        const currentY = this.invasion.y - this.invasion.recoilY;
        const hx = this.invasion.x + shakeX;
        const hy = currentY;

        ctx.translate(hx, hy);

        // 如果有自訂手部圖片 URL
        const customImg = (this.invasion.handType === 'custom' && this.invasion.customHandUrl)
            ? (window.FishImageCache ? window.FishImageCache.getImage(this.invasion.customHandUrl) : null)
            : null;

        if (customImg && customImg.loaded) {
            const w = 70;
            const aspect = (customImg.height && customImg.width) ? (customImg.height / customImg.width) : 1.3;
            const h = w * aspect;
            // 垂直手臂入水
            ctx.drawImage(customImg, -w / 2, -h + 30, w, h);
        } else if (this.invasion.handType === 'human') {
            this.drawHumanHand(ctx);
        } else if (this.invasion.handType === 'tuxedoCat') {
            this.drawCatPaw(ctx, '#2d3436', '#ffffff');
        } else {
            // 預設：超萌橘貓爪
            this.drawCatPaw(ctx, '#e67e22', '#f39c12');
        }

        // 水花漣漪
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, -hy + this.surfaceY, 26, 6, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();

        // 頂部倒數進度條與防禦指示
        this.drawInvasionHUD(ctx);
    }

    drawCatPaw(ctx, mainColor, stripeColor) {
        // 毛茸茸手臂本體 (從上方伸下)
        ctx.fillStyle = mainColor;
        ctx.beginPath();
        ctx.moveTo(-16, -260);
        ctx.lineTo(-20, -10);
        ctx.quadraticCurveTo(-22, 18, 0, 20);
        ctx.quadraticCurveTo(22, 18, 20, -10);
        ctx.lineTo(16, -260);
        ctx.closePath();
        ctx.fill();

        // 斑紋
        ctx.fillStyle = stripeColor;
        ctx.fillRect(-14, -80, 28, 8);
        ctx.fillRect(-16, -45, 32, 9);
        ctx.fillRect(-18, -15, 36, 10);

        // 貓掌肉墊底色（白爪手套）
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(0, 8, 21, 14, 0, 0, Math.PI * 2);
        ctx.fill();

        // 粉紅肉球 (Paw Pads)
        ctx.fillStyle = '#ff7675';
        // 中央大肉墊
        ctx.beginPath();
        ctx.ellipse(0, 10, 9, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // 四顆小指肉球
        const toePositions = [
            { x: -13, y: 3, r: 3.2 },
            { x: -5, y: -1, r: 3.5 },
            { x: 5, y: -1, r: 3.5 },
            { x: 13, y: 3, r: 3.2 }
        ];
        toePositions.forEach(t => {
            ctx.beginPath();
            ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
            ctx.fill();
        });

        // 伸縮利爪 (Claws)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 2;
        toePositions.forEach(t => {
            const clawExtend = 5 + Math.sin(this.invasion.clawPhase) * 2;
            ctx.beginPath();
            ctx.moveTo(t.x, t.y + 4);
            ctx.lineTo(t.x + (t.x > 0 ? 2 : -2), t.y + 4 + clawExtend);
            ctx.stroke();
        });
    }

    drawHumanHand(ctx) {
        // 卡通手臂
        ctx.fillStyle = '#ffbb99';
        ctx.fillRect(-14, -260, 28, 240);

        // 手掌與五指
        ctx.beginPath();
        ctx.arc(0, -10, 16, 0, Math.PI * 2);
        ctx.fill();

        // 手指伸長抓取
        for (let i = -2; i <= 2; i++) {
            ctx.lineWidth = 6;
            ctx.lineCap = 'round';
            ctx.strokeStyle = '#ffbb99';
            ctx.beginPath();
            ctx.moveTo(i * 6, -5);
            ctx.lineTo(i * 7, 18 + Math.sin(this.invasion.clawPhase + i) * 3);
            ctx.stroke();
        }
    }

    drawInvasionHUD(ctx) {
        ctx.save();
        const hudW = Math.min(320, this.width - 40);
        const hudH = 34;
        const hudX = (this.width - hudW) / 2;
        const hudY = 12;

        // 警告外框背景
        ctx.fillStyle = 'rgba(231, 76, 60, 0.85)';
        ctx.strokeStyle = '#f1c40f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(hudX, hudY, hudW, hudH, 8) : ctx.rect(hudX, hudY, hudW, hudH);
        ctx.fill();
        ctx.stroke();

        // 倒數文字
        const secondsLeft = Math.max(0, Math.ceil(this.invasion.timeLeft));
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`🚨 快點擊擊退捕魚手！倒數 ${secondsLeft}s`, hudX + 10, hudY + 21);

        // 抵擋打擊次數
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffd700';
        ctx.fillText(`已拍打: ${this.invasion.hitCount} 次`, hudX + hudW - 10, hudY + 21);

        ctx.restore();
    }
}

window.ParticleManager = ParticleManager;
window.FoodPellet = FoodPellet;
