/**
 * 系统设置里的「项目」四页（管理 / 成员 / 默认值 / 安全策略）。
 *
 * ## 为什么它们在这里，而不是侧边栏弹窗
 *
 * 原来项目设置是用户菜单里开出来的一个 Modal，带自己的标签栏。它和系统设置里的东西是同
 * 一类——都在改配置、都是"点了不立刻生效的地方"、都需要一个可分享的地址——却住在另一个
 * 入口、另一种容器里。于是"改项目"要在两个地方找，而"改个人"和"改项目"永远不在同一个
 * 菜单下。现在统一收进系统设置，菜单按 分组（项目 / 个人 / 服务器） 组织。
 *
 * ## 复用而非复制
 *
 * 四页的内容直接复用 components/layout/project-dialogs.tsx 里原有的分区组件——它们本来
 * 就是完整的表单，搬过来只是换了个外壳。刻意不在这里重写一份：同一份"成员权限表"存在
 * 两处，迟早会只改一处。
 *
 * ## 没有项目时的处理
 *
 * 项目是这些页面的前提（每页都要 projectId），所以没有当前项目时渲染一段说明而不是空白
 * 或报错。菜单那侧不隐藏这些行，是为了让"为什么点不开"有个可见的答案。
 */
import { useNavigate } from "react-router";
import { useProject } from "../../state/project";
import {
  ChatDefaultsSection,
  MembersSection,
  ProjectManageSection,
  SecurityPolicySection,
} from "../../components/layout/project-dialogs";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";

export type ProjectSettingsPage = "manage" | "members" | "defaults" | "security";

export interface ProjectSectionsProps {
  /** Which of the four pages to draw. */
  page: ProjectSettingsPage;
}

/** The Project + role every page needs, or null when there is no current Project. */
function useProjectTarget(): { projectId: string; isOwner: boolean } | null {
  const { currentProject } = useProject();
  if (!currentProject) return null;
  return { projectId: currentProject.projectId, isOwner: currentProject.role === "owner" };
}

export function ProjectSections({ page }: ProjectSectionsProps) {
  const navigate = useNavigate();
  const target = useProjectTarget();

  // 删除当前项目后没有"上一层"可关，必须自己走。设置页的其它页面不会遇到这件事，因为它们
  // 操作的是自己（改自己的偏好），不会把自己删掉。
  const leaveSettings = () => navigate("/chat");

  if (!target) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.project.noCurrentProject}</p>
        <Button size="sm" className="mt-3" onClick={leaveSettings}>
          {S.settings.backToWorkspace}
        </Button>
      </div>
    );
  }

  switch (page) {
    case "members":
      return <MembersSection projectId={target.projectId} isOwner={target.isOwner} />;
    case "defaults":
      return <ChatDefaultsSection projectId={target.projectId} isOwner={target.isOwner} />;
    case "security":
      return <SecurityPolicySection projectId={target.projectId} isOwner={target.isOwner} />;
    case "manage":
      return (
        <ProjectManageSection
          projectId={target.projectId}
          isOwner={target.isOwner}
          onGone={leaveSettings}
        />
      );
  }
}
