<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  Cpu,
} from "lucide-vue-next";
import type { ReasoningLevel } from "@ai-chat/shared";

interface ReasoningOption {
  value: ReasoningLevel;
  label: string;
  description: string;
}

const OFF_REASONING_OPTION: ReasoningOption = {
  value: "off",
  label: "关闭",
  description: "快速回答，不进行深度思考",
};

const REASONING_OPTIONS: ReasoningOption[] = [
  OFF_REASONING_OPTION,
  { value: "low", label: "低", description: "轻量分析，兼顾速度与准确性" },
  { value: "high", label: "高", description: "适合需要多步分析的复杂问题" },
  { value: "max", label: "最大", description: "最强推理，可能更慢并消耗更多 Token" },
];

const props = defineProps<{
  model: string;
  modelValue: ReasoningLevel;
  levels: ReasoningLevel[];
  disabled: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: ReasoningLevel];
}>();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const open = ref(false);
const availableOptions = computed(() =>
  REASONING_OPTIONS.filter((option) => props.levels.includes(option.value)),
);
const selectedOption = computed(
  () =>
    availableOptions.value.find((option) => option.value === props.modelValue) ??
    availableOptions.value[0] ??
    OFF_REASONING_OPTION,
);
const modelLongName = computed(() =>
  props.model === "deepseek-v4-flash" ? "DeepSeek V4 Flash" : props.model,
);
const modelShortName = computed(() =>
  props.model === "deepseek-v4-flash" ? "V4 Flash" : props.model,
);

function optionButtons(): HTMLButtonElement[] {
  return root.value
    ? [...root.value.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    : [];
}

async function openMenu(focus: "selected" | "first" | "last" = "selected") {
  if (props.disabled || availableOptions.value.length === 0) {
    return;
  }
  open.value = true;
  await nextTick();
  const buttons = optionButtons();
  const selectedIndex = availableOptions.value.findIndex(
    (option) => option.value === props.modelValue,
  );
  const index =
    focus === "first"
      ? 0
      : focus === "last"
        ? buttons.length - 1
        : Math.max(0, selectedIndex);
  buttons[index]?.focus();
}

function closeMenu(returnFocus = false): void {
  open.value = false;
  if (returnFocus) {
    void nextTick(() => trigger.value?.focus());
  }
}

function toggleMenu(): void {
  if (open.value) {
    closeMenu();
  } else {
    void openMenu();
  }
}

function select(level: ReasoningLevel): void {
  emit("update:modelValue", level);
  closeMenu(true);
}

function handleTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    void openMenu(event.key === "ArrowDown" ? "first" : "last");
  }
}

function handleListKeydown(event: KeyboardEvent): void {
  const buttons = optionButtons();
  const currentIndex = buttons.findIndex(
    (button) => button === document.activeElement,
  );
  let nextIndex: number | null = null;

  if (event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1 + buttons.length) % buttons.length;
  } else if (event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = buttons.length - 1;
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeMenu(true);
    return;
  }

  if (nextIndex !== null && buttons.length > 0) {
    event.preventDefault();
    buttons[nextIndex]?.focus();
  }
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (open.value && !root.value?.contains(event.target as Node)) {
    closeMenu();
  }
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      closeMenu();
    }
  },
);

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
});
</script>

<template>
  <div ref="root" class="reasoning-selector">
    <button
      ref="trigger"
      class="model-pill"
      type="button"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="`${modelLongName}，推理强度：${selectedOption.label}`"
      @click="toggleMenu"
      @keydown="handleTriggerKeydown"
    >
      <Cpu :size="14" />
      <span class="model-name-long">{{ modelLongName }}</span>
      <span class="model-name-short">{{ modelShortName }}</span>
      <span class="model-mode" :data-level="selectedOption.value">
        <BrainCircuit v-if="selectedOption.value !== 'off'" :size="11" />
        <Check v-else :size="11" />
        {{ selectedOption.label }}
      </span>
      <ChevronDown class="model-chevron" :class="{ open }" :size="13" />
    </button>

    <div
      v-if="open"
      class="reasoning-menu"
      role="listbox"
      aria-label="推理强度"
      @keydown="handleListKeydown"
    >
      <div class="reasoning-menu-heading">推理强度</div>
      <button
        v-for="option in availableOptions"
        :key="option.value"
        class="reasoning-option"
        :class="{ selected: option.value === modelValue }"
        type="button"
        role="option"
        :aria-selected="option.value === modelValue"
        @click="select(option.value)"
      >
        <span class="reasoning-option-copy">
          <strong>{{ option.label }}</strong>
          <small>{{ option.description }}</small>
        </span>
        <Check
          v-if="option.value === modelValue"
          class="reasoning-option-check"
          :size="16"
        />
      </button>
    </div>
  </div>
</template>
