export interface JudgeData {
  id: string;
  name: string;
  email: string;
  type: "Pro" | "General";
  room: string;
  prizes: string[];
}

export interface TeamMember {
  name: string;
  level: "Pro" | "General" | "Beginner";
}

export interface Project {
  id: string;
  name: string;
  tableNumber: number;
  room: string;
  track: "Pro" | "General";
  devpostLink: string;
  githubLink?: string;
  description: string;
  teamMembers?: TeamMember[];
  nominations?: string[];
}

export interface AdminStats {
  totalJudges: number;
  totalProjects: number;
  judgedProjects: number;
  rooms: { id: string; judged: number; total: number }[];
}

export interface AdminJudge {
  id: string;
  name: string;
  email: string;
  type: string;
  room: string;
  status: "online" | "offline";
  projectsJudged: number;
  prizes?: string[];
}

export interface JudgeNomination {
  judgeId: string;
  judgeName: string;
  judgeType: string;
  prizes: string[];
  notes?: string;
}

export interface AdminProject {
  id: string;
  name: string;
  tableNumber: number;
  room: string;
  track: "Pro" | "General";
  devpostLink: string;
  description: string;
  nominatedPrizes: string[];    // deduplicated list of all prizes nominated for
  totalNominations: number;
  judgeNominations: JudgeNomination[];  // per-judge breakdown
  pairwiseWins: number;
  pairwiseLosses: number;
}

export type FlagReason =
  | { type: "unregistered_member"; members: string[] }
  | { type: "general_in_pro_track"; members: string[] }
  | { type: "commits_after_deadline"; commitHash: string; commitTime: string; deadline: string };

export interface FlaggedTeamMember {
  name: string;
  level: "Pro" | "General" | "Beginner";
  registered: boolean;
}

export interface AdminFlaggedProject {
  id: string;
  name: string;
  tableNumber: number;
  room: string;
  track: "Pro" | "General";
  devpostLink: string;
  githubLink?: string;
  description: string;
  teamMembers: FlaggedTeamMember[];
  flags: FlagReason[];
}
