import type { AppConfig } from "../../config/types.js";
import { FirestoreListenClient } from "../../firestore/firestoreListenClient.js";
import { FirestoreRestClient } from "../../firestore/firestoreRestClient.js";
import type { Logger } from "../../util/logger.js";
import { KindroidChatsClient } from "./chats.js";
import { KindroidGroupChatsClient } from "./groupChats.js";
import { KindroidGroupsClient } from "./groups.js";
import { KindroidKinsClient } from "./kins.js";

export class KindroidApiClient {
  readonly chats: KindroidChatsClient;
  readonly groupChats: KindroidGroupChatsClient;
  readonly groups: KindroidGroupsClient;
  readonly kins: KindroidKinsClient;

  constructor(config: AppConfig, logger: Logger) {
    const firestoreRest = new FirestoreRestClient(config, logger);
    const firestoreListen = new FirestoreListenClient(config, logger);

    this.chats = new KindroidChatsClient(firestoreRest, firestoreListen);
    this.groupChats = new KindroidGroupChatsClient(firestoreRest, firestoreListen);
    this.groups = new KindroidGroupsClient(firestoreRest, firestoreListen);
    this.kins = new KindroidKinsClient(firestoreRest);
  }
}

export type { KindroidKin } from "./kins.js";
export type { KindroidGroup } from "./groups.js";
