import type NodeBle from "node-ble";

/** Raw D-Bus variant value as returned by dbus-next */
export interface DbusVariant<T = unknown> {
  value: T;
}

/** org.bluez.Device1 interface properties from ObjectManager */
export interface BluezDevice1Props {
  Address?: DbusVariant<string>;
  Name?: DbusVariant<string>;
  Alias?: DbusVariant<string>;
  [key: string]: DbusVariant | undefined;
}

/** Interfaces map from ObjectManager.GetManagedObjects / InterfacesAdded */
export type BluezInterfacesMap = Record<string, BluezDevice1Props>;

/** Minimal subset of the dbus-next ObjectManager proxy */
export interface DbusObjectManager {
  GetManagedObjects(): Promise<Record<string, BluezInterfacesMap>>;
  on(
    event: "InterfacesAdded",
    listener: (objectPath: string, interfaces: BluezInterfacesMap) => void,
  ): this;
  removeAllListeners(event: "InterfacesAdded"): this;
}

/** Minimal subset of the dbus-next MessageBus */
export interface DbusBus {
  getProxyObject(
    service: string,
    path: string,
  ): Promise<{
    getInterface(iface: string): DbusObjectManager;
  }>;
}

/** node-ble BusHelper internal class */
export interface NodeBleBusHelper {
  callMethod(method: string, ...args: unknown[]): Promise<unknown>;
}

/** node-ble Adapter at runtime has these extra properties not in the public interface */
export interface AdapterInternal extends NodeBle.Adapter {
  dbus: DbusBus;
  adapter: string;
  helper: NodeBleBusHelper;
}
