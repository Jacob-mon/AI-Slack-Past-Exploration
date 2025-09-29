export interface Workspace {
  id: string;
  name: string;
  teamIcon: string;
  scopes: string[];
}

export interface Channel {
  id: string;
  name:string;
}

export interface SearchParams {
  keyword: string;
  startDate: string;
  endDate: string;
  channels: string[];
}