<script setup>
defineProps({
  steps: { type: Array, required: true },
  current: { type: Number, default: 0 },
  done: { type: Array, default: () => [] },
})

const emit = defineEmits(['jump'])
</script>

<template>
  <div class="rail">
    <div
      v-for="(s, i) in steps"
      :key="s.key"
      class="rail-item"
      :class="{
        'is-on': i === current,
        'is-done': done.includes(i),
      }"
      @click="emit('jump', i)"
    >
      <span class="rail-dot">
        <svg v-if="done.includes(i)" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.5 5.5L20 6.5" /></svg>
        <template v-else>{{ i + 1 }}</template>
      </span>
      <span class="rail-label">
        <strong>{{ s.title }}</strong>
        <em>{{ s.desc }}</em>
      </span>
      <span v-if="i < steps.length - 1" class="rail-line"></span>
    </div>
  </div>
</template>

<style scoped>
.rail {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 2px 0 18px;
}

.rail-item {
  display: flex;
  align-items: center;
  gap: 9px;
  position: relative;
  cursor: pointer;
  flex: 0 0 auto;
  user-select: none;
}

.rail-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  color: #9a9ab0;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(30, 30, 60, 0.08);
  transition: all 0.2s ease;
  flex: 0 0 auto;
}

.rail-item.is-on .rail-dot {
  background: linear-gradient(150deg, #6d9cfb, #4f7df3);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 4px 12px rgba(79, 125, 243, 0.35);
}

.rail-item.is-done .rail-dot {
  background: linear-gradient(150deg, #7ed6b0, #46b98a);
  border-color: transparent;
  color: #fff;
}

.rail-label {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-right: 4px;
}

.rail-label strong {
  font-size: 12.5px;
  font-weight: 600;
  color: #3b3b52;
  white-space: nowrap;
}

.rail-label em {
  font-style: normal;
  font-size: 10px;
  color: #a5a5b8;
  white-space: nowrap;
}

.rail-item.is-on .rail-label strong {
  color: #1d1d2e;
}

.rail-line {
  width: clamp(18px, 3.2vw, 54px);
  height: 1px;
  background: linear-gradient(90deg, rgba(120, 120, 160, 0.28), rgba(120, 120, 160, 0.14));
  margin: 0 10px;
  flex: 0 0 auto;
}
</style>
