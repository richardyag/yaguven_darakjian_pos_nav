/** @odoo-module **/
import { Component, useState, onMounted } from "@odoo/owl";
import { usePos } from "@point_of_sale/app/hooks/pos_hook";

export class DarakjianCategoryTree extends Component {
    static template = "yaguven_darakjian_pos_nav.CategoryTree";
    static props = {};

    setup() {
        this.pos = usePos();
        this.state = useState({ expandedByDepth: {} });
        // This tree replaced the native CategorySelector. On mount, seed the selected
        // category with the first one available in the config, so the POS does not show
        // every product at once - which locks the browser up with thousands of cards and
        // image requests.
        onMounted(() => {
            // With the native CategorySelector gone, nothing else starts the
            // selection. Opening on the first available category beats showing the whole
            // catalog. Images are no longer a performance problem: the ProductCard
            // override adds loading="lazy", so only the visible ones are fetched.
            if (!this.pos.selectedCategory) {
                const configCatIds = this.pos.config.iface_available_categ_ids || [];
                const firstId = configCatIds.length
                    ? (configCatIds[0]?.id ?? configCatIds[0])
                    : null;
                if (firstId) {
                    this.pos.setSelectedCategory(firstId);
                }
            }
        });
    }

    _rel(val) {
        return val && val.id !== undefined ? val.id : val;
    }

    get roots() {
        const cats = this.pos.models["pos.category"].getAll();
        const childrenOf = {};
        for (const c of cats) {
            const pid = c.parent_id ? this._rel(c.parent_id) : null;
            (childrenOf[pid] = childrenOf[pid] || []).push(c);
        }
        const sortFn = (a, b) => (a.sequence - b.sequence) || (a.id - b.id);

        // Builds the COMPLETE tree, unpruned: every category is shown with its
        // hierarchy, exactly as the inventory view does. Branches with no loaded products
        // used to be pruned, but with lazy loading (only priority products at startup)
        // that hid nearly the whole tree. Clicking a category loads its products on
        // demand.
        const build = (cat, depth) => {
            const children = (childrenOf[cat.id] || [])
                .sort(sortFn)
                .map((c) => build(c, depth + 1));
            return { id: cat.id, name: cat.name, depth, children };
        };

        return (childrenOf[null] || []).sort(sortFn).map((c) => build(c, 0));
    }

    get selectedCategoryId() {
        return this.pos.selectedCategory?.id ?? null;
    }

    isExpanded(node) {
        return this.state.expandedByDepth[node.depth] === node.id;
    }

    toggleExpand(node) {
        const cur = { ...this.state.expandedByDepth };
        if (cur[node.depth] === node.id) {
            for (const d of Object.keys(cur)) {
                if (Number(d) >= node.depth) delete cur[d];
            }
        } else {
            for (const d of Object.keys(cur)) {
                if (Number(d) > node.depth) delete cur[d];
            }
            cur[node.depth] = node.id;
        }
        this.state.expandedByDepth = cur;
    }

    selectCategory(node) {
        this.pos.setSelectedCategory(node.id);
        this.close();
    }

    clearCategory() {
        // Clearing the selection shows every product.
        this.pos.selectedCategory = null;
        this.close();
    }

    close() {
        this.pos.darakjianTreeOpen = false;
    }
}
