<script setup lang="ts">
import { computed } from "vue";
import { Moon, Sun } from "lucide-vue-next";
import type { Theme } from "../composables/use_theme";

const props = defineProps<{
  theme: Theme;
}>();

const emit = defineEmits<{
  toggle: [];
}>();

const nextThemeLabel = computed(() =>
  props.theme === "light" ? "切换到深色模式" : "切换到浅色模式",
);
</script>

<template>
  <button
    class="theme-toggle"
    type="button"
    :aria-label="nextThemeLabel"
    :title="nextThemeLabel"
    :aria-pressed="theme === 'dark'"
    @click="emit('toggle')"
  >
    <Moon v-if="theme === 'light'" :size="15" aria-hidden="true" />
    <Sun v-else :size="15" aria-hidden="true" />
    <span class="theme-toggle-label">{{ nextThemeLabel }}</span>
  </button>
</template>
