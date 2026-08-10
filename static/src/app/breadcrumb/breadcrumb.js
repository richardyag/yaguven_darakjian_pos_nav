/** @odoo-module **/
// Breadcrumb for the selected category: shows the path from the root down to the
// current category (e.g. Jewelry > Rings > Wedding Bands). Every level is clickable to
// jump straight to it. It reads pos.selectedCategory, a reactive getter on the PosStore,
// so it keeps itself up to date as the user navigates.

import { Component } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/hooks/pos_hook";

export class DarakjianBreadcrumb extends Component {
    static template = "yaguven_darakjian_pos_nav.Breadcrumb";
    static props = {};

    setup() {
        this.pos = usePos();
    }

    /** Resolves a parent_id that may arrive either as a record (when the m2o is
     *  loaded) or as a raw id, always returning the pos.category record or null. */
    _resolve(rel) {
        if (!rel) {
            return null;
        }
        if (rel.id !== undefined) {
            return rel;
        }
        return this.pos.models["pos.category"].get(rel) || null;
    }

    /** The chain from root to current. The Set guard prevents an infinite loop should
     *  the data ever contain a cycle of parent_id. */
    get trail() {
        let node = this.pos.selectedCategory;
        if (!node || !node.id) {
            return [];
        }
        const chain = [];
        const seen = new Set();
        while (node && node.id && !seen.has(node.id)) {
            seen.add(node.id);
            chain.unshift({ id: node.id, name: node.name });
            node = this._resolve(node.parent_id);
        }
        return chain;
    }

    selectCrumb(catId) {
        this.pos.setSelectedCategory(catId);
    }
}
