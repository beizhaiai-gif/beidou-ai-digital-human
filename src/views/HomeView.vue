<script setup>
import PromptBox from '../components/PromptBox.vue'
import Icon from '../components/Icon.vue'

const cards = [
  {
    key: 'image',
    tag: 'IMAGE',
    title: '图片生成',
    desc: '把想象变成画面',
    img: '/cards/image.jpg',
    tint: 'linear-gradient(155deg, #1b2140 0%, #2a2b52 45%, #151830 100%)',
  },
  {
    key: 'video',
    tag: 'VIDEO',
    title: '视频生成',
    desc: '让故事开始发生',
    img: '/cards/video.jpg',
    tint: 'linear-gradient(155deg, #1a1a2e 0%, #2e2338 45%, #12121f 100%)',
  },
  {
    key: 'chat',
    tag: 'CREATE',
    title: '文本对话',
    desc: '写文案 · 理思路 · 做脚本',
    img: '/cards/create.jpg',
    tint: 'linear-gradient(155deg, #241b3d 0%, #382650 45%, #191227 100%)',
  },
  {
    key: 'agent',
    tag: 'AGENT',
    title: '智能体与工具',
    desc: '让专业能力随点随用',
    img: '/cards/agent.jpg',
    tint: 'linear-gradient(155deg, #141b31 0%, #243050 45%, #0e1222 100%)',
  },
]

const mini = [
  { key: 'avatar', title: '数字人台', desc: '选题 → 文案 → 出片 → 剪辑', icon: 'avatar' },
  { key: '', title: '短 · 漫剧', desc: '整理脚本与项目', icon: 'film' },
]

const emit = defineEmits(['go'])

function open(key) {
  if (key) emit('go', key)
}
</script>

<template>
  <div class="scroll">
    <section class="hero">
      <div class="hero-head">
        <div>
          <h1 class="hero-title">今天，想创作点什么？</h1>
          <p class="hero-sub">写文案、生成图片、制作视频，都可以交给我</p>
        </div>
        <button class="inspire">
          去广场找灵感
          <Icon name="arrowUpRight" :size="13" />
        </button>
      </div>

      <div class="cards">
        <article
          v-for="c in cards"
          :key="c.tag"
          class="card"
          :class="{ 'card--todo': !c.key }"
          role="button"
          tabindex="0"
          @click="open(c.key)"
          @keyup.enter="open(c.key)"
        >
          <div class="card-media" :style="{ background: c.tint }">
            <div class="card-media-img" :style="{ backgroundImage: `url(${c.img})` }"></div>
          </div>
          <div class="card-body">
            <span class="card-tag">{{ c.tag }}</span>
            <div class="card-foot">
              <div class="card-text">
                <h3 class="card-title">{{ c.title }}</h3>
                <p class="card-desc">{{ c.desc }}</p>
              </div>
              <button class="card-go" :aria-label="c.title">
                <Icon name="arrowUpRight" :size="14" />
              </button>
            </div>
          </div>
        </article>
      </div>

      <div class="mini-row">
        <button
          v-for="m in mini"
          :key="m.title"
          class="mini"
          :class="{ 'mini--hl': m.key === 'avatar' }"
          @click="open(m.key)"
        >
          <span class="mini-ico"><Icon :name="m.icon" :size="16" /></span>
          <span class="mini-text">
            <strong>{{ m.title }}</strong>
            <em>{{ m.desc }}</em>
          </span>
          <Icon name="arrowUpRight" :size="14" class="mini-arrow" />
        </button>
      </div>

      <PromptBox @go="emit('go', $event)" />
    </section>
  </div>
</template>

<style scoped>
.scroll {
  flex: 1;
  overflow-y: auto;
  padding: 6px 18px 18px;
}

.hero {
  width: 100%;
}

.hero-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}

.hero-title {
  font-size: 25px;
  line-height: 1.28;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: #17172a;
}

.hero-sub {
  margin-top: 8px;
  font-size: 12.5px;
  color: #82829a;
}

.inspire {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  color: #6a6a80;
  padding: 5px 8px;
  border-radius: 8px;
  white-space: nowrap;
  transition: background 0.16s ease, color 0.16s ease;
}

.inspire:hover {
  background: rgba(255, 255, 255, 0.8);
  color: #33334a;
}

.cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 13px;
}

.card {
  position: relative;
  aspect-ratio: 1.62;
  border-radius: 12px;
  overflow: hidden;
  color: #fff;
  box-shadow: 0 8px 22px rgba(24, 24, 60, 0.14);
  transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.28s ease;
  cursor: pointer;
}

.card:hover {
  transform: translateY(-3px);
  box-shadow: 0 14px 30px rgba(24, 24, 60, 0.2);
}

.card:focus-visible {
  outline: 2px solid rgba(79, 125, 243, 0.6);
  outline-offset: 2px;
}

.card--todo {
  cursor: default;
}

.card-media {
  position: absolute;
  inset: 0;
}

.card-media-img {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
}

.card-media::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(8, 10, 24, 0.42) 0%,
    rgba(8, 10, 24, 0.06) 42%,
    rgba(8, 10, 24, 0.68) 100%
  );
}

.card-body {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 11px 13px 12px;
}

.card-tag {
  font-size: 9.5px;
  letter-spacing: 1.8px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.72);
}

.card-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
}

.card-title {
  font-size: 14.5px;
  font-weight: 700;
  letter-spacing: 0.2px;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.35);
}

.card-desc {
  margin-top: 4px;
  font-size: 10.5px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.72);
}

.card-go {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.28);
  backdrop-filter: blur(6px);
  color: #fff;
  transition: background 0.18s ease, transform 0.18s ease;
}

.card-go:hover {
  background: rgba(255, 255, 255, 0.36);
  transform: rotate(45deg);
}

.mini-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
  margin-top: 13px;
}

.mini {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: var(--shadow-sm);
  text-align: left;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.mini:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(60, 60, 110, 0.09);
}

.mini--hl {
  background: linear-gradient(100deg, rgba(255, 245, 252, 0.92), rgba(245, 248, 255, 0.92));
  border-color: rgba(255, 214, 240, 0.9);
}

.mini-ico {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: linear-gradient(150deg, #f3f5fd, #e8edfa);
  color: #63719c;
  border: 1px solid rgba(255, 255, 255, 0.9);
}

.mini--hl .mini-ico {
  background: linear-gradient(150deg, #fdeaf8, #eef0ff);
  color: #9a6bb0;
}

.mini-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.mini-text strong {
  font-size: 12.5px;
  font-weight: 600;
  color: #26263a;
}

.mini-text em {
  font-style: normal;
  font-size: 10.5px;
  color: #9a9ab0;
}

.mini-arrow {
  color: #b6b6c8;
  flex: 0 0 auto;
}

@media (max-width: 1280px) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 860px) {
  .cards,
  .mini-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .hero-title {
    font-size: 21px;
  }
}

@media (max-width: 720px) {
  .scroll {
    padding: 6px 14px 16px;
  }
}
</style>
