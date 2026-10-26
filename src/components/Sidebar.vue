<script setup>
import Icon from './Icon.vue'

const groups = [
  {
    title: '开始创作',
    items: [
      { key: 'chat', label: '文本对话', icon: 'chat' },
      { key: 'image', label: '图片创作', icon: 'image' },
      { key: 'video', label: '视频创作', icon: 'video' },
      { key: 'avatar', label: '数字人台', icon: 'avatar' },
      { key: 'agent', label: '智能体与工具', icon: 'agent' },
    ],
  },
  {
    title: '我的工作区',
    items: [
      { key: 'works', label: '我的作品', icon: 'folder' },
      { key: 'bench', label: '工作台', icon: 'grid' },
    ],
  },
]

const solo = [
  { key: 'publish', label: '内容发布', icon: 'publish' },
  { key: 'square', label: '作品广场', icon: 'sparkle' },
]

defineProps({
  active: { type: String, default: 'home' },
  user: { type: Object, default: () => ({ name: '北斋', role: '', avatarText: '北' }) },
})
const emit = defineEmits(['select', 'settings'])
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">北</div>
      <span class="brand-name">北抖AI数字人</span>
    </div>

    <nav class="nav">
      <button class="nav-item nav-item--top" :class="{ on: active === 'home' }" @click="emit('select', 'home')">
        <Icon name="home" :size="17" />
        <span>创作首页</span>
      </button>

      <div v-for="g in groups" :key="g.title" class="nav-group">
        <p class="nav-title">{{ g.title }}</p>
        <button
          v-for="it in g.items"
          :key="it.key"
          class="nav-item"
          :class="{ on: active === it.key }"
          @click="emit('select', it.key)"
        >
          <Icon :name="it.icon" :size="17" />
          <span>{{ it.label }}</span>
        </button>
      </div>

      <div class="nav-group nav-group--solo">
        <button
          v-for="it in solo"
          :key="it.key"
          class="nav-item"
          :class="{ on: active === it.key }"
          @click="emit('select', it.key)"
        >
          <Icon :name="it.icon" :size="17" />
          <span>{{ it.label }}</span>
        </button>
      </div>
    </nav>

    <div class="side-foot">
      <button class="foot-row">
        <Icon name="bell" :size="16" />
        <span>通知</span>
      </button>
      <button class="foot-user" @click="emit('settings')">
        <img
          v-if="user?.avatarUrl"
          class="avatar avatar--img"
          :src="user.avatarUrl"
          :alt="user?.name || '头像'"
        />
        <span v-else class="avatar avatar--txt">{{ user?.avatarText || '北' }}</span>
        <span class="user-meta">
          <span class="user-name">{{ user?.name || '未命名' }}</span>
          <span v-if="user?.role" class="user-role">{{ user.role }}</span>
        </span>
        <span class="gear" title="设置"><Icon name="settings" :size="14" /></span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  flex: 0 0 var(--sidebar-w);
  align-self: stretch;
  display: flex;
  flex-direction: column;
  padding: 14px 12px 10px;
  margin: 0;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(26px) saturate(1.25);
  -webkit-backdrop-filter: blur(26px) saturate(1.25);
  border: 1px solid rgba(255, 255, 255, 0.95);
  border-radius: 18px;
  box-shadow:
    0 1px 2px rgba(40, 40, 80, 0.04),
    0 8px 26px rgba(50, 50, 100, 0.07),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  overflow: hidden;
}

.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 2px 6px 16px;
}

.brand-mark {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: linear-gradient(140deg, #7aa7ff, #4f7df3 55%, #8f6bf5);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  display: grid;
  place-items: center;
  box-shadow: 0 2px 8px rgba(79, 125, 243, 0.32);
}

.brand-name {
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: #24243a;
}

.nav {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-group {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-group--solo {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.nav-title {
  font-size: 11px;
  color: var(--ink-3);
  padding: 0 10px 6px;
  letter-spacing: 0.4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border-radius: 9px;
  font-size: 13px;
  color: var(--ink-2);
  transition: background 0.16s ease, color 0.16s ease;
  text-align: left;
}

.nav-item svg {
  color: #8b8b9e;
  flex: 0 0 auto;
}

.nav-item:hover {
  background: rgba(240, 240, 250, 0.85);
  color: var(--ink);
}

.nav-item.on {
  background: linear-gradient(100deg, rgba(255, 228, 246, 0.95), rgba(255, 246, 252, 0.6));
  color: #1a1a26;
  font-weight: 500;
}

.nav-item.on svg {
  color: #5b5b75;
}

.nav-item--top {
  margin-bottom: 2px;
}

.side-foot {
  padding-top: 10px;
  border-top: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.foot-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 10px;
  border-radius: 9px;
  font-size: 13px;
  color: var(--ink-2);
}

.foot-row svg {
  color: #8b8b9e;
}

.foot-row:hover {
  background: rgba(240, 240, 250, 0.85);
}

.foot-user {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 40px;
  padding: 0 9px;
  border-radius: 10px;
  margin-top: 2px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.9);
}

.foot-user:hover {
  background: #fff;
}

.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(150deg, #dfe6f7, #c9d6f0);
  display: grid;
  place-items: center;
  color: #6d7b9c;
  flex: 0 0 auto;
}

.avatar--txt {
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  border: none;
}

.avatar--img {
  object-fit: cover;
  display: block;
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 6px rgba(40, 40, 80, 0.12);
}
.user-meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
  text-align: left;
}
.user-role {
  font-size: 9.5px;
  color: #a5a5b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gear {
  flex: 0 0 auto;
  color: #a5a5b8;
  display: grid;
  place-items: center;
  transition: color 0.15s ease, transform 0.3s ease;
}
.foot-user:hover .gear {
  color: #4f7df3;
  transform: rotate(35deg);
}
.user-name {
  font-size: 12.5px;
  color: var(--ink-2);
  flex: 1;
  text-align: left;
}

.user-caret {
  color: #a8a8bb;
}
</style>
