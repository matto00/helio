import { createListenerMiddleware, addListener } from "@reduxjs/toolkit";

import type { RootState, AppDispatch } from "./store";

export const listenerMiddleware = createListenerMiddleware();

export type AppStartListening = typeof listenerMiddleware.startListening<RootState, AppDispatch>;

export const startAppListening = listenerMiddleware.startListening as AppStartListening;

export const addAppListener = addListener.withTypes<RootState, AppDispatch>();
