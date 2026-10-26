import React from 'react';
import {Composition, staticFile} from 'remotion';

/**
 * 卡片实验台（自动生成，勿手改 —— 改 scripts/gen_lab.mjs）
 *
 * 目的：把技能里的卡片逐个真渲一遍，看它到底长什么样、要喂什么内容。
 * 只用名字猜出来的说明书不可靠，这里全部按实测写。
 *
 * 108 张卡，各按自己的 meta 时长、960×540 渲。
 * 人物素材用后台那条 12 秒数字人原片。
 */
import * as c_alt_block_lines from './cards/alt-block-lines';
import * as c_bar_chart_growth from './cards/bar-chart-growth';
import * as c_bed_echo_blur from './cards/bed-echo-blur';
import * as c_behind_text_title from './cards/behind-text-title';
import * as c_black_slam_transition from './cards/black-slam-transition';
import * as c_callout_line_label from './cards/callout-line-label';
import * as c_caret_wipe_transition from './cards/caret-wipe-transition';
import * as c_chapter_progress_list from './cards/chapter-progress-list';
import * as c_chapter_title_card from './cards/chapter-title-card';
import * as c_chart_grow from './cards/chart-grow';
import * as c_chat_gpt from './cards/chat-gpt';
import * as c_chat_message_flow from './cards/chat-message-flow';
import * as c_chevron_lower_third from './cards/chevron-lower-third';
import * as c_chip_grid_single_select from './cards/chip-grid-single-select';
import * as c_claude_code from './cards/claude-code';
import * as c_color_slam_beat_card from './cards/color-slam-beat-card';
import * as c_converging_arrows from './cards/converging-arrows';
import * as c_corner_bracket_frame from './cards/corner-bracket-frame';
import * as c_count_badge_title from './cards/count-badge-title';
import * as c_countdown_arc_scatter from './cards/countdown-arc-scatter';
import * as c_crash_zoom_punch from './cards/crash-zoom-punch';
import * as c_cursor_actor_demo from './cards/cursor-actor-demo';
import * as c_cursor_locked_zoom from './cards/cursor-locked-zoom';
import * as c_danmu_bubble_praise from './cards/danmu-bubble-praise';
import * as c_doc_park_left_pill_deal from './cards/doc-park-left-pill-deal';
import * as c_douyin_follow_card from './cards/douyin-follow-card';
import * as c_error_retype from './cards/error-retype';
import * as c_evidence_scroll_tour from './cards/evidence-scroll-tour';
import * as c_filmstrip_conveyor from './cards/filmstrip-conveyor';
import * as c_flying_words from './cards/flying-words';
import * as c_focus_dim_spotlight from './cards/focus-dim-spotlight';
import * as c_gallery_wall_dolly from './cards/gallery-wall-dolly';
import * as c_glass_code_walk from './cards/glass-code-walk';
import * as c_gooey_morph from './cards/gooey-morph';
import * as c_grid_to_hero from './cards/grid-to-hero';
import * as c_hand_drawn_ellipse from './cards/hand-drawn-ellipse';
import * as c_highlighter_sweep from './cards/highlighter-sweep';
import * as c_host_card_glass_board from './cards/host-card-glass-board';
import * as c_host_shrink_to_chip from './cards/host-shrink-to-chip';
import * as c_impact_open_title from './cards/impact-open-title';
import * as c_info_card_assemble from './cards/info-card-assemble';
import * as c_info_term_card from './cards/info-term-card';
import * as c_ink_underline from './cards/ink-underline';
import * as c_keyword_pop_highlight from './cards/keyword-pop-highlight';
import * as c_lead_word_zoom_assemble from './cards/lead-word-zoom-assemble';
import * as c_line_by_line_slide from './cards/line-by-line-slide';
import * as c_line_carry_transition from './cards/line-carry-transition';
import * as c_line_chart_story_draw from './cards/line-chart-story-draw';
import * as c_logo_enter from './cards/logo-enter';
import * as c_long_take_world from './cards/long-take-world';
import * as c_lower_third_nameplate from './cards/lower-third-nameplate';
import * as c_magnifier_detail from './cards/magnifier-detail';
import * as c_map_route_pin from './cards/map-route-pin';
import * as c_media_pop_in from './cards/media-pop-in';
import * as c_metric_with_sparkline from './cards/metric-with-sparkline';
import * as c_motion_blur_slam_in from './cards/motion-blur-slam-in';
import * as c_news_card_desk from './cards/news-card-desk';
import * as c_number_counter from './cards/number-counter';
import * as c_number_slab_pop from './cards/number-slab-pop';
import * as c_numbered_step_stack from './cards/numbered-step-stack';
import * as c_orbit_drift from './cards/orbit-drift';
import * as c_outline_box_title from './cards/outline-box-title';
import * as c_overexpose_flip_transition from './cards/overexpose-flip-transition';
import * as c_parallel_items_with_host from './cards/parallel-items-with-host';
import * as c_particle_weld_transition from './cards/particle-weld-transition';
import * as c_pencil_sketch_draw from './cards/pencil-sketch-draw';
import * as c_per_character_rise from './cards/per-character-rise';
import * as c_pip_zoom_box from './cards/pip-zoom-box';
import * as c_pullback_cool_transition from './cards/pullback-cool-transition';
import * as c_push_through_transition from './cards/push-through-transition';
import * as c_quote_bracket_pull from './cards/quote-bracket-pull';
import * as c_quote_card from './cards/quote-card';
import * as c_quote_hold_arrow from './cards/quote-hold-arrow';
import * as c_rack_focus_pair from './cards/rack-focus-pair';
import * as c_reticle_lock_on from './cards/reticle-lock-on';
import * as c_scanline_annotate from './cards/scanline-annotate';
import * as c_scribble_annotation from './cards/scribble-annotation';
import * as c_shape_wipe_transition from './cards/shape-wipe-transition';
import * as c_slab_punch_title from './cards/slab-punch-title';
import * as c_slow_pull_reveal from './cards/slow-pull-reveal';
import * as c_slow_push_in from './cards/slow-push-in';
import * as c_soft_blur_in from './cards/soft-blur-in';
import * as c_source_converge from './cards/source-converge';
import * as c_speed_slab_title from './cards/speed-slab-title';
import * as c_split_60_40_story from './cards/split-60-40-story';
import * as c_split_compare_slider from './cards/split-compare-slider';
import * as c_split_text_stagger from './cards/split-text-stagger';
import * as c_stack_fan_out from './cards/stack-fan-out';
import * as c_stage_keyframe_tour from './cards/stage-keyframe-tour';
import * as c_step_timeline_vertical from './cards/step-timeline-vertical';
import * as c_still_layout_relay from './cards/still-layout-relay';
import * as c_strike_and_replace from './cards/strike-and-replace';
import * as c_subscribe_cta from './cards/subscribe-cta';
import * as c_sway_parallax from './cards/sway-parallax';
import * as c_terminal_typing_log from './cards/terminal-typing-log';
import * as c_tilt_3d_page from './cards/tilt-3d-page';
import * as c_timeline_photo_strip from './cards/timeline-photo-strip';
import * as c_title_demote_to_label from './cards/title-demote-to-label';
import * as c_tracking_in from './cards/tracking-in';
import * as c_type_contrast_emphasis from './cards/type-contrast-emphasis';
import * as c_typewriter_reveal from './cards/typewriter-reveal';
import * as c_ui_flow_theater from './cards/ui-flow-theater';
import * as c_ui_prop_theater from './cards/ui-prop-theater';
import * as c_unit_grid_proportion from './cards/unit-grid-proportion';
import * as c_whip_pan_transition from './cards/whip-pan-transition';
import * as c_word_relay_filmstrip from './cards/word-relay-filmstrip';
import * as c_word_slot_cycle from './cards/word-slot-cycle';
import * as c_x_follow_card from './cards/x-follow-card';

const HOST = 'video/host.mp4';

const hostBox = (Comp: React.ComponentType<any>) => {
  const W: React.FC = () => <Comp hostSrc={staticFile(HOST)} />;
  return W;
};
const plain = (Comp: React.ComponentType<any>) => {
  const W: React.FC = () => <Comp />;
  return W;
};

const LAB = [
  {id: 'lab-alt-block-lines', mod: c_alt_block_lines, mode: 'host'},
  {id: 'lab-bar-chart-growth', mod: c_bar_chart_growth, mode: 'host'},
  {id: 'lab-bed-echo-blur', mod: c_bed_echo_blur, mode: 'plain'},
  {id: 'lab-behind-text-title', mod: c_behind_text_title, mode: 'host'},
  {id: 'lab-black-slam-transition', mod: c_black_slam_transition, mode: 'host'},
  {id: 'lab-callout-line-label', mod: c_callout_line_label, mode: 'plain'},
  {id: 'lab-caret-wipe-transition', mod: c_caret_wipe_transition, mode: 'host'},
  {id: 'lab-chapter-progress-list', mod: c_chapter_progress_list, mode: 'host'},
  {id: 'lab-chapter-title-card', mod: c_chapter_title_card, mode: 'host'},
  {id: 'lab-chart-grow', mod: c_chart_grow, mode: 'plain'},
  {id: 'lab-chat-gpt', mod: c_chat_gpt, mode: 'host'},
  {id: 'lab-chat-message-flow', mod: c_chat_message_flow, mode: 'host'},
  {id: 'lab-chevron-lower-third', mod: c_chevron_lower_third, mode: 'host'},
  {id: 'lab-chip-grid-single-select', mod: c_chip_grid_single_select, mode: 'plain'},
  {id: 'lab-claude-code', mod: c_claude_code, mode: 'host'},
  {id: 'lab-color-slam-beat-card', mod: c_color_slam_beat_card, mode: 'host'},
  {id: 'lab-converging-arrows', mod: c_converging_arrows, mode: 'host'},
  {id: 'lab-corner-bracket-frame', mod: c_corner_bracket_frame, mode: 'host'},
  {id: 'lab-count-badge-title', mod: c_count_badge_title, mode: 'host'},
  {id: 'lab-countdown-arc-scatter', mod: c_countdown_arc_scatter, mode: 'plain'},
  {id: 'lab-crash-zoom-punch', mod: c_crash_zoom_punch, mode: 'plain'},
  {id: 'lab-cursor-actor-demo', mod: c_cursor_actor_demo, mode: 'host'},
  {id: 'lab-cursor-locked-zoom', mod: c_cursor_locked_zoom, mode: 'host'},
  {id: 'lab-danmu-bubble-praise', mod: c_danmu_bubble_praise, mode: 'host'},
  {id: 'lab-doc-park-left-pill-deal', mod: c_doc_park_left_pill_deal, mode: 'plain'},
  {id: 'lab-douyin-follow-card', mod: c_douyin_follow_card, mode: 'plain'},
  {id: 'lab-error-retype', mod: c_error_retype, mode: 'plain'},
  {id: 'lab-evidence-scroll-tour', mod: c_evidence_scroll_tour, mode: 'host'},
  {id: 'lab-filmstrip-conveyor', mod: c_filmstrip_conveyor, mode: 'plain'},
  {id: 'lab-flying-words', mod: c_flying_words, mode: 'plain'},
  {id: 'lab-focus-dim-spotlight', mod: c_focus_dim_spotlight, mode: 'host'},
  {id: 'lab-gallery-wall-dolly', mod: c_gallery_wall_dolly, mode: 'plain'},
  {id: 'lab-glass-code-walk', mod: c_glass_code_walk, mode: 'host'},
  {id: 'lab-gooey-morph', mod: c_gooey_morph, mode: 'host'},
  {id: 'lab-grid-to-hero', mod: c_grid_to_hero, mode: 'plain'},
  {id: 'lab-hand-drawn-ellipse', mod: c_hand_drawn_ellipse, mode: 'host'},
  {id: 'lab-highlighter-sweep', mod: c_highlighter_sweep, mode: 'host'},
  {id: 'lab-host-card-glass-board', mod: c_host_card_glass_board, mode: 'host'},
  {id: 'lab-host-shrink-to-chip', mod: c_host_shrink_to_chip, mode: 'host'},
  {id: 'lab-impact-open-title', mod: c_impact_open_title, mode: 'host'},
  {id: 'lab-info-card-assemble', mod: c_info_card_assemble, mode: 'plain'},
  {id: 'lab-info-term-card', mod: c_info_term_card, mode: 'host'},
  {id: 'lab-ink-underline', mod: c_ink_underline, mode: 'host'},
  {id: 'lab-keyword-pop-highlight', mod: c_keyword_pop_highlight, mode: 'host'},
  {id: 'lab-lead-word-zoom-assemble', mod: c_lead_word_zoom_assemble, mode: 'plain'},
  {id: 'lab-line-by-line-slide', mod: c_line_by_line_slide, mode: 'plain'},
  {id: 'lab-line-carry-transition', mod: c_line_carry_transition, mode: 'plain'},
  {id: 'lab-line-chart-story-draw', mod: c_line_chart_story_draw, mode: 'host'},
  {id: 'lab-logo-enter', mod: c_logo_enter, mode: 'host'},
  {id: 'lab-long-take-world', mod: c_long_take_world, mode: 'plain'},
  {id: 'lab-lower-third-nameplate', mod: c_lower_third_nameplate, mode: 'host'},
  {id: 'lab-magnifier-detail', mod: c_magnifier_detail, mode: 'host'},
  {id: 'lab-map-route-pin', mod: c_map_route_pin, mode: 'host'},
  {id: 'lab-media-pop-in', mod: c_media_pop_in, mode: 'host'},
  {id: 'lab-metric-with-sparkline', mod: c_metric_with_sparkline, mode: 'host'},
  {id: 'lab-motion-blur-slam-in', mod: c_motion_blur_slam_in, mode: 'host'},
  {id: 'lab-news-card-desk', mod: c_news_card_desk, mode: 'host'},
  {id: 'lab-number-counter', mod: c_number_counter, mode: 'host'},
  {id: 'lab-number-slab-pop', mod: c_number_slab_pop, mode: 'host'},
  {id: 'lab-numbered-step-stack', mod: c_numbered_step_stack, mode: 'host'},
  {id: 'lab-orbit-drift', mod: c_orbit_drift, mode: 'host'},
  {id: 'lab-outline-box-title', mod: c_outline_box_title, mode: 'host'},
  {id: 'lab-overexpose-flip-transition', mod: c_overexpose_flip_transition, mode: 'host'},
  {id: 'lab-parallel-items-with-host', mod: c_parallel_items_with_host, mode: 'host'},
  {id: 'lab-particle-weld-transition', mod: c_particle_weld_transition, mode: 'host'},
  {id: 'lab-pencil-sketch-draw', mod: c_pencil_sketch_draw, mode: 'host'},
  {id: 'lab-per-character-rise', mod: c_per_character_rise, mode: 'plain'},
  {id: 'lab-pip-zoom-box', mod: c_pip_zoom_box, mode: 'host'},
  {id: 'lab-pullback-cool-transition', mod: c_pullback_cool_transition, mode: 'host'},
  {id: 'lab-push-through-transition', mod: c_push_through_transition, mode: 'host'},
  {id: 'lab-quote-bracket-pull', mod: c_quote_bracket_pull, mode: 'host'},
  {id: 'lab-quote-card', mod: c_quote_card, mode: 'host'},
  {id: 'lab-quote-hold-arrow', mod: c_quote_hold_arrow, mode: 'host'},
  {id: 'lab-rack-focus-pair', mod: c_rack_focus_pair, mode: 'plain'},
  {id: 'lab-reticle-lock-on', mod: c_reticle_lock_on, mode: 'plain'},
  {id: 'lab-scanline-annotate', mod: c_scanline_annotate, mode: 'plain'},
  {id: 'lab-scribble-annotation', mod: c_scribble_annotation, mode: 'host'},
  {id: 'lab-shape-wipe-transition', mod: c_shape_wipe_transition, mode: 'host'},
  {id: 'lab-slab-punch-title', mod: c_slab_punch_title, mode: 'host'},
  {id: 'lab-slow-pull-reveal', mod: c_slow_pull_reveal, mode: 'host'},
  {id: 'lab-slow-push-in', mod: c_slow_push_in, mode: 'host'},
  {id: 'lab-soft-blur-in', mod: c_soft_blur_in, mode: 'host'},
  {id: 'lab-source-converge', mod: c_source_converge, mode: 'plain'},
  {id: 'lab-speed-slab-title', mod: c_speed_slab_title, mode: 'host'},
  {id: 'lab-split-60-40-story', mod: c_split_60_40_story, mode: 'host'},
  {id: 'lab-split-compare-slider', mod: c_split_compare_slider, mode: 'plain'},
  {id: 'lab-split-text-stagger', mod: c_split_text_stagger, mode: 'plain'},
  {id: 'lab-stack-fan-out', mod: c_stack_fan_out, mode: 'plain'},
  {id: 'lab-stage-keyframe-tour', mod: c_stage_keyframe_tour, mode: 'host'},
  {id: 'lab-step-timeline-vertical', mod: c_step_timeline_vertical, mode: 'host'},
  {id: 'lab-still-layout-relay', mod: c_still_layout_relay, mode: 'plain'},
  {id: 'lab-strike-and-replace', mod: c_strike_and_replace, mode: 'host'},
  {id: 'lab-subscribe-cta', mod: c_subscribe_cta, mode: 'host'},
  {id: 'lab-sway-parallax', mod: c_sway_parallax, mode: 'host'},
  {id: 'lab-terminal-typing-log', mod: c_terminal_typing_log, mode: 'host'},
  {id: 'lab-tilt-3d-page', mod: c_tilt_3d_page, mode: 'host'},
  {id: 'lab-timeline-photo-strip', mod: c_timeline_photo_strip, mode: 'plain'},
  {id: 'lab-title-demote-to-label', mod: c_title_demote_to_label, mode: 'plain'},
  {id: 'lab-tracking-in', mod: c_tracking_in, mode: 'plain'},
  {id: 'lab-type-contrast-emphasis', mod: c_type_contrast_emphasis, mode: 'host'},
  {id: 'lab-typewriter-reveal', mod: c_typewriter_reveal, mode: 'host'},
  {id: 'lab-ui-flow-theater', mod: c_ui_flow_theater, mode: 'plain'},
  {id: 'lab-ui-prop-theater', mod: c_ui_prop_theater, mode: 'host'},
  {id: 'lab-unit-grid-proportion', mod: c_unit_grid_proportion, mode: 'plain'},
  {id: 'lab-whip-pan-transition', mod: c_whip_pan_transition, mode: 'host'},
  {id: 'lab-word-relay-filmstrip', mod: c_word_relay_filmstrip, mode: 'plain'},
  {id: 'lab-word-slot-cycle', mod: c_word_slot_cycle, mode: 'plain'},
  {id: 'lab-x-follow-card', mod: c_x_follow_card, mode: 'host'},
] as const;

export const LabRoot: React.FC = () => (
  <>
    {LAB.map(({id, mod, mode}) => {
      const Comp = (mod as any).default as React.ComponentType<any>;
      const dur = Math.max(30, Number((mod as any).meta?.durationInFrames) || 90);
      const W = mode === 'host' ? hostBox(Comp) : plain(Comp);
      return (
        <Composition key={id} id={id} component={W} durationInFrames={dur} fps={30} width={960} height={540} />
      );
    })}
  </>
);
