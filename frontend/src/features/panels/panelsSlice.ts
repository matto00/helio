import { createSlice, nanoid, type PayloadAction } from "@reduxjs/toolkit";

export interface Panel {
  id: string;
  dashboardId: string;
  title: string;
}

interface PanelsState {
  items: Panel[];
}

const initialState: PanelsState = {
  items: [],
};

interface AddPanelInput {
  dashboardId: string;
  title: string;
}

const panelsSlice = createSlice({
  name: "panels",
  initialState,
  reducers: {
    addPanel: {
      reducer(state, action: PayloadAction<Panel>) {
        state.items.push(action.payload);
      },
      prepare(input: AddPanelInput) {
        return {
          payload: {
            id: nanoid(),
            dashboardId: input.dashboardId,
            title: input.title,
          },
        };
      },
    },
  },
});

export const { addPanel } = panelsSlice.actions;
export const panelsReducer = panelsSlice.reducer;
