/**
 * The agent browser's shared vocabulary: the rules about addresses that both the user (in
 * the address bar) and the agent (in the tool) need, so the two can never disagree about
 * what a string means.
 */
export {
  BLANK_URL,
  SEARCH_URL,
  addressOf,
  displayAddress,
  isBareHost,
  isBlankUrl,
  resolveAddress,
  tabLabel,
} from "./address.js";
